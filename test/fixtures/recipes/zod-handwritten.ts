// No loading at run time: a hand-written zod schema, checked against the server's schema
import { z } from "zod";
import type { User, Address } from "./user.schema.yaml";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assertEqual<A, B>(..._: Equal<A, B> extends true ? [] : [never]): void {}

const AddressZod = z.object({ city: z.string(), zip: z.string().optional() });

export const UserZod = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string().nullable().optional(),
  role: z.enum(["admin", "member"]),
  tags: z.array(z.string()).optional(),
  address: AddressZod.optional(),
  get friends() {
    return z.array(UserZod).optional();
  },
});

// Fails to compile once the schema file and the zod schema drift apart
assertEqual<z.infer<typeof AddressZod>, Address>();
assertEqual<z.infer<typeof UserZod>, User>();
