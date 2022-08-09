#!/usr/bin/env node

import {
    RabbitMQ,
    SqlDB,
    DateTime,
    Logger,
    Types
} from 'ikomida-shared';
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
    .replace(/^\w/, m => m.toUpperCase())
    .replace(/-\w/g, m => m[1].toUpperCase())

class ReferralJob {

    amqp
    logger

    constructor() {
        this.logger = Logger.getInstance(name, process.env?.ENV !== 'PROD')
    }

    async run() {
        try {
            const today = new Date()
            const thisMonth = today.getMonth() + 1
            const thisYear = today.getFullYear()
            const stringDate = `${thisYear}-${thisMonth}-01`
            const date = new Date(stringDate)
            const bonusLevels = await SqlDB.SettingModel.findOne({
                where: {
                    name: 'ReferralBonusLevels',

                }
            })
            let referrals = await SqlDB.ReferralModel.findAll({
                logging: console.log,
                order: [
                    ['createdAt', 'DESC']
                ], include: {
                    model: SqlDB.ReferralRevuneModel,
                    where: {
                        date: {
                            [SqlDB.Op.gte]: date
                        }
                    },
                    required: false
                }
            })
            referrals = referrals?.filter(referral => (referral?.referralRevunes?.length ?? 0) === 0)
            console.log("count referrals:", referrals?.length)
            for (const referral of referrals) {
                console.log("step:", 0)
                let total = 0
                let revune = 0
                let revuneDetails = []
                const contracts = await referral?.getContractReferredBy()
                console.log("step:", 1)
                for (const contract of contracts) {
                    const payments = await contract?.getContractPayments({
                        order: [
                            ['confirmedDate', 'ASC']
                        ],
                        where: {
                            status: {
                                [SqlDB.Op.in]: [Types.PaymentStatusTypes.Asaas.CONFIRMED, Types.PaymentStatusTypes.Asaas.AVAILABLE]
                            },
                            confirmedDate: {
                                [SqlDB.Op.lt]: DateTime?.parseAsaasDate(stringDate)
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
                        revune += payment.value * percentage
                        total += payment.value
                        revuneDetails.push({ contractId: contract.id, paymentId: payment.id, percentage, value, revune })
                    }
                }
                console.log("step:", 2)
                let usersByReferral = await referral?.getReferredBy()
                let bonus = 0
                let bonusDetails = []
                for (let index = 0; index < (bonusLevels?.length ?? 0); index++) {
                    if ((usersByReferral?.length ?? 0) > 0) {
                        let levelBonus = 0
                        let levelTotal = 0
                        let newUsersByReferral = []
                        for (const userByReferral of usersByReferral) {
                            const userReferral = await userByReferral?.getReferral()
                            const userReferralRevenue = await userReferral?.getReferralRevunes({
                                order: [
                                    ['createdAt', 'ASC']
                                ],
                                limit: 1,
                                where: {
                                    createdAt: {
                                        [SqlDB.Op.gte]: date
                                    }

                                }
                            })
                            if ((userReferralRevenue?.length ?? 0) === 1) {
                                levelTotal += userReferralRevenue[0].revune
                            }
                            newUsersByReferral = [...newUsersByReferral, ...await userReferral.getReferredBy()]
                        }
                        levelBonus += levelTotal * (bonusLevels[index] / 100)
                        bonus += levelBonus
                        bonusDetails.push({ level: index, porcentage: bonusLevels?.[index], resellers: usersByReferral?.length, total: levelTotal, bonus: levelBonus })
                        usersByReferral = newUsersByReferral
                    }
                }
                console.log("step:", 3)
                await referral.createReferralRevune({
                    date,
                    total,
                    revune,
                    revuneDetails,
                    bonus,
                    bonusDetails
                }, {
                    logging: console.log
                })
                console.log("step:", 4)
            }
            console.log("step:", 5)
        } catch (exception) {
            console.error(exception)
            this.logger.error(exception)
        }
    }
}

await (new ReferralJob).run()