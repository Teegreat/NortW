import type { Request, Response } from "express";
import { getEnv } from "../lib/env";
import { verifyWebhook } from "@clerk/express/webhooks";
import { parseRole } from "../lib/roles";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export async function clerkWebhookHandler(req: Request, res: Response) {
  const env = getEnv();

  try {
    // verify webhooks config/secret
    if (!env.CLERK_WEBHOOK_SECRET) {
      res.status(503).send("Webhooks secret not provided");
      return;
    }

    // throws if signature is wrong or body was tampered with; only then we trust the event (evt)
    const evt = await verifyWebhook(req, {
      signingSecret: env.CLERK_WEBHOOK_SECRET,
    });

    if (evt.type === "user.created" || evt.type === "user.updated") {
      const user = evt.data;

      const email =
        user.email_addresses?.find(
          (e) => e.id === user.primary_email_address_id,
        )?.email_address ?? user.email_addresses?.[0]?.email_address;

      if (!email) {
        console.warn("Skipping Clerk user sync because email is missing", {
          clerkUserId: user.id,
        });
        res.json({ ok: true, skipped: "missing_email" });
        return;
      }

      const displayName =
        [user.first_name, user.last_name].filter(Boolean).join(" ") ||
        user.username ||
        email;

      const role = parseRole(user.public_metadata?.role);

      await db
        .insert(users)
        .values({
          clerkUserId: user.id,
          email,
          displayName,
          role,
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: {
            email,
            displayName,
            role,
            updatedAt: new Date(),
          },
        });
    }

    if (evt.type === "user.deleted") {
      const id = evt.data.id;
      if (id) {
        await db.delete(users).where(eq(users.clerkUserId, id));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    // Bad signature, malformed payload or DB error - do not leak details to the client
    console.error("Clerk webhook error", err);
  }
}
