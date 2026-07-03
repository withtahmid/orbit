import { Kysely } from "kysely";

/**
 * Fully decouples categories from envelopes.
 *
 * Migration 041 already made `transactions.envelop_id` the source of truth
 * for which envelope an expense belongs to; the category kept a
 * `default_envelop_id` purely as an entry-form prefill hint. That hint has
 * been a chronic source of UX bugs — categories tied to archived envelopes,
 * mangled picker trees, a forced envelope choice at category-create time —
 * while pins and per-form defaults prefill better. Categories are now pure
 * labels; envelopes attach only to transactions.
 */
export const up = async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable("expense_categories").dropColumn("default_envelop_id").execute();
};

export const down = async (db: Kysely<any>): Promise<void> => {
    // The dropped hints are not recoverable — restore the column nullable so
    // rollback at least reinstates the schema shape.
    await db.schema
        .alterTable("expense_categories")
        .addColumn("default_envelop_id", "uuid", (col) => col.references("envelops.id"))
        .execute();
};
