const { z } = require('zod');

const transactionIntentSchema = z.object({
    intent: z.enum([
        "CREATE_TRANSACTION",
        "BATCH_CREATE",
        "GET_SUMMARY",
        "GET_HISTORY",
        "GET_DEBT",
        "PAY_DEBT",
        "CREATE_TRIP",
        "SELECT_TRIP",
        "LIST_TRIP",
        "ADD_MEMBER",
        "LIST_MEMBER",
        "EDIT_TRANSACTION",
        "DELETE_TRANSACTION",
        "RESTORE_TRANSACTION",
        "HELP",
        "UNKNOWN"
    ]),

    type: z.preprocess(
        val => (val === '' || val === undefined) ? null : val,
        z.enum(["EXPENSE", "TRANSFER"]).nullable().optional().default(null)
    ),

    transactions: z.array(
        z.object({
            type: z.enum(["EXPENSE", "TRANSFER"]).default("EXPENSE"),
            amount: z.number().int().positive(),
            grand_total: z.number().int().positive().nullable().optional().default(null),
            description: z.string().max(255),
            category: z.string().max(100).nullable().optional().default(null),
            paid_by: z.string().max(100).nullable().optional().default(null),
            split_type: z.enum(["NONE", "EQUAL", "CUSTOM"]).nullable().optional().default("NONE"),
            split_members: z.array(
                z.union([
                    z.string().max(100),
                    z.object({
                        name: z.string().max(100),
                        amount: z.number().int().positive()
                    })
                ])
            ).optional().default([]),
            transaction_date: z.string().nullable().optional().default(null)
        })
    ).optional().default([]),

    amount: z.preprocess(
        val => {
            if (val === 0 || val === '0') return null;
            if (typeof val === 'string') {
                const parsed = parseInt(val, 10);
                return isNaN(parsed) ? null : parsed;
            }
            return val;
        },
        z.number()
            .int()
            .positive()
            .nullable()
            .optional()
            .default(null)
    ),

    description: z.preprocess(
        val => (val === '' || val === undefined) ? null : val,
        z.string().max(255).nullable().optional().default(null)
    ),

    category: z.preprocess(
        val => (val === '' || val === undefined) ? null : val,
        z.string().max(100).nullable().optional().default(null)
    ),

    paid_by: z.preprocess(
        val => (val === '' || val === undefined) ? null : val,
        z.string().max(100).nullable().optional().default(null)
    ),

    split_type: z.preprocess(
        val => (val === '' || val === undefined) ? null : val,
        z.enum(["NONE", "EQUAL", "CUSTOM"]).nullable().optional().default(null)
    ),

    split_members: z.preprocess(
        val => val === null || val === undefined ? [] : val,
        z.array(
            z.union([
                z.string().max(100),
                z.object({
                    name: z.string().max(100),
                    amount: z.number().int().positive()
                })
            ])
        ).max(50)
    ).optional().default([]),

    transaction_date: z.string().nullable().optional().default(null),

    confidence: z.preprocess(
        val => typeof val === 'number' ? val : 1.0,
        z.number().min(0).max(1)
    ).optional().default(1.0),

    needs_confirmation: z.preprocess(
        val => typeof val === 'boolean' ? val : false,
        z.boolean()
    ).optional().default(false),

    missing_fields: z.preprocess(
        val => val === null || val === undefined ? [] : val,
        z.array(z.string())
    ).optional().default([])
});

module.exports = {
    transactionIntentSchema,
};
