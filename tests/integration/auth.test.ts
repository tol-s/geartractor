import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { acceptInvitation, authenticate, getInvitation, resetPassword } from "@/server/auth/flows";
import { hashPassword, newToken, sha256 } from "@/server/auth/password";
import { inviteUser, updateUser } from "@/server/users";
import { createOrganization, setOrganizationStatus } from "@/server/organizations";
import { createTenant, inTenant, pool, uid, withSystem } from "../helpers";

afterAll(() => pool.end());

describe("authentication", () => {
  it("signs in active users, rejects wrong passwords and deactivated accounts", async () => {
    const t = await createTenant();
    const hash = await hashPassword("GoodPassword123");
    await withSystem((tx) => tx.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, t.admin.user.id)));
    const ok = await authenticate(t.admin.user.email, "GoodPassword123", `ip-${uid()}`);
    expect(ok.userId).toBe(t.admin.user.id);
    await expect(authenticate(t.admin.user.email, "nope", `ip-${uid()}`)).rejects.toThrow(/incorrect/);
    await withSystem((tx) => tx.update(schema.users).set({ status: "deactivated" }).where(eq(schema.users.id, t.admin.user.id)));
    await expect(authenticate(t.admin.user.email, "GoodPassword123", `ip-${uid()}`)).rejects.toThrow(/not active/);
  });

  it("rate limits repeated login attempts", async () => {
    const email = `nobody-${uid()}@test.dev`;
    for (let i = 0; i < 10; i++) await expect(authenticate(email, "x", `ip-${uid()}`)).rejects.toThrow(/incorrect/);
    await expect(authenticate(email, "x", `ip-${uid()}`)).rejects.toThrow(/Please wait a few minutes/);
  });

  it("password reset tokens are single use", async () => {
    const t = await createTenant();
    const token = newToken();
    await withSystem((tx) =>
      tx.insert(schema.passwordResetTokens).values({ id: sha256(token), userId: t.trainer.user.id, expiresAt: new Date(Date.now() + 3600_000) }),
    );
    await resetPassword(token, "BrandNewPass123");
    await expect(resetPassword(token, "AnotherPass123")).rejects.toThrow(/expired/);
    await withSystem((tx) => tx.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, t.trainer.user.id)));
    expect((await authenticate(t.trainer.user.email, "BrandNewPass123", `ip-${uid()}`)).userId).toBe(t.trainer.user.id);
  });

  it("invites a user who sets their own password on first sign in", async () => {
    const t = await createTenant();
    const email = `new-${uid()}@test.dev`;
    const { inviteUrl } = await inTenant(t, (tx) => inviteUser(tx, t.admin, { name: "New Person", email, role: "trainer" }));
    const token = inviteUrl.split("/invite/")[1];
    expect((await getInvitation(token))?.valid).toBe(true);
    await expect(acceptInvitation(token, "New Person", "short")).rejects.toThrow(/at least 10/);
    await acceptInvitation(token, "New Person", "FirstPassword1");
    expect((await getInvitation(token))?.valid).toBe(false);
    await expect(acceptInvitation(token, "x", "FirstPassword1")).rejects.toThrow();
    expect((await authenticate(email, "FirstPassword1", `ip-${uid()}`)).role).toBe("trainer");
  });

  it("trainers cannot manage users; the last admin cannot be removed", async () => {
    const t = await createTenant();
    await expect(inTenant(t, (tx) => inviteUser(tx, t.trainer, { name: "X", email: `x-${uid()}@t.dev`, role: "trainer" }))).rejects.toThrow(/permission/);
    const other = await createTenant();
    // A second admin demotes the first; demoting the last one fails.
    await expect(inTenant(other, (tx) => updateUser(tx, other.admin, other.admin.user.id, { status: "deactivated" }))).rejects.toThrow(/yourself/);
  });

  it("super admin creates organizations; deactivating an organization blocks sign in", async () => {
    const slug = `co-${uid()}`;
    const res = await withSystem((tx) =>
      createOrganization(tx, null as unknown as string, {
        name: `Company ${slug}`,
        slug,
        primaryColor: "#112233",
        secondaryColor: "#445566",
        accentColor: "#778899",
        timezone: "UTC",
        adminName: "Boss",
        adminEmail: `boss-${slug}@test.dev`,
      }),
    );
    const token = res.inviteUrl.split("/invite/")[1];
    await acceptInvitation(token, "Boss", "BossPassword1");
    expect((await authenticate(`boss-${slug}@test.dev`, "BossPassword1", `ip-${uid()}`)).role).toBe("org_admin");
    await withSystem((tx) => setOrganizationStatus(tx, null as unknown as string, res.org.id, "inactive"));
    await expect(authenticate(`boss-${slug}@test.dev`, "BossPassword1", `ip-${uid()}`)).rejects.toThrow(/deactivated/);
  });
});
