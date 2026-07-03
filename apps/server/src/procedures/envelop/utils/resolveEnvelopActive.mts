import { Kysely } from "kysely";
import { TRPCError } from "@trpc/server";
import type { DB } from "../../../db/kysely/types.mjs";

/**
 * Throw if the envelope is missing, not in the given space, or archived.
 * Use as a guard before any operation that creates new state attached to
 * the envelope.
 */
export async function resolveEnvelopActive({
    trx,
    envelopId,
    spaceId,
}: {
    trx: Kysely<DB>;
    envelopId: string;
    spaceId?: string;
}): Promise<void> {
    const env = await trx
        .selectFrom("envelops")
        .select(["id", "space_id", "archived", "name"])
        .where("envelops.id", "=", envelopId)
        .executeTakeFirst();

    if (!env || (spaceId !== undefined && env.space_id !== spaceId)) {
        throw new TRPCError({
            code: "NOT_FOUND",
            message: "Envelop not found",
        });
    }

    if (env.archived) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Envelope "${env.name}" is archived. Unarchive it first to add new activity.`,
        });
    }
}
