import { DBModels, Domain, Types, Utils, Logics } from "@ikomida/shared-backend";
import {
    createRequire
} from "module";
const require = createRequire(
    import.meta.url)
let {
    name
} = require("../package.json")
name = name
    .replace(/^(@\S+\/)?(svelte-)?(\S+)/, '$3')
    .replace(/^\w/, (m: string) => m.toUpperCase())
    .replace(/-\w/g, (m: string[]) => m[1].toUpperCase())

class ReferralJob {

    amqp: any
    logger

    constructor() {
        this.logger = Utils.Logger.getInstance(name)
    }

    async run() {
        try {
            const today = new Date()
            const thisMonth = today.getMonth() + 1
            const thisYear = today.getFullYear()
            const stringDate = `${thisYear}-${thisMonth}-01`
            const date = new Date(stringDate)
            const bonusLevelsModel = await DBModels.SettingModel.findOne({
                where: {
                    name: 'ReferralBonusLevels',

                }
            })
            const bonusLevels = JSON.parse(bonusLevelsModel?.value ?? '[]') as []
            let referrals = await DBModels.ReferralModel.findAll({
                order: [
                    ['createdAt', 'DESC']
                ], include: {
                    model: DBModels.ReferralRevuneModel,
                    where: {
                        date: {
                            [Domain.SqlDB.Op.gte]: date
                        }
                    },
                    required: false
                }
            })
            referrals = referrals?.filter(referral => (referral?.referralRevunes?.length ?? 0) === 0)
            for (const referral of referrals) {
                let total = 0
                let revune = 0
                const revuneDetails = []
                const contracts = await referral?.$get('contracts')
                for (const contract of contracts) {
                    const payments = await contract?.$get('contractPayments', {
                        order: [
                            ['confirmedDate', 'ASC']
                        ],
                        where: {
                            status: {
                                [Domain.SqlDB.Op.in]: [Types.Types.TAsaasPaymentStatus.CONFIRMED, Types.Types.TAsaasPaymentStatus.RECEIVED]
                            },
                            confirmedDate: {
                                [Domain.SqlDB.Op.lt]: Logics.DateTime?.parseAsaasDate(stringDate)
                            }
                        }
                    })
                    const totalPayments = (payments?.length ?? 0)
                    if (totalPayments > 0 && totalPayments < 6) {
                        let percentage = 0.1
                        if (totalPayments === 2) {
                            percentage = 0.3
                        }
                        const payment = payments?.[totalPayments - 1]
                        revune += (payment?.value ?? 0) * percentage
                        total += (payment?.value ?? 0)
                        revuneDetails.push({ contractId: contract.id, paymentId: payment.id, percentage, total, revune })
                    }
                }
                let usersByReferral = await referral?.$get('users')
                let bonus = 0
                const bonusDetails = []
                for (let index = 0; index < (bonusLevels?.length ?? 0); index++) {
                    if ((usersByReferral?.length ?? 0) > 0) {
                        let levelBonus = 0
                        let levelTotal = 0
                        let newUsersByReferral: any[] = []
                        for (const userByReferral of usersByReferral) {
                            const userReferral = await userByReferral?.$get('referral')
                            const userReferralRevenue = await userReferral?.$get('referralRevunes', {
                                order: [
                                    ['createdAt', 'ASC']
                                ],
                                limit: 1,
                                where: {
                                    createdAt: {
                                        [Domain.SqlDB.Op.gte]: date
                                    }

                                }
                            })
                            if ((userReferralRevenue?.length ?? 0) === 1) {
                                levelTotal += userReferralRevenue ? [0]?.revune ?? 0
                            }
                            newUsersByReferral = [...newUsersByReferral, ...await userReferral.getReferredBy()]
                        }
                        levelBonus += levelTotal * (bonusLevels[index] / 100)
                        bonus += levelBonus
                        bonusDetails.push({ level: index, percentage: bonusLevels?.[index], resellers: usersByReferral?.length, total: levelTotal, bonus: levelBonus })
                        usersByReferral = newUsersByReferral
                    }
                }
                await referral.createReferralRevune({
                    date,
                    total,
                    revune,
                    revuneDetails,
                    bonus,
                    bonusDetails
                })
            }
        } catch (exception) {
            console.error(exception)
            this.logger.error(exception)
        }
    }
}

await (new ReferralJob).run()