import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://timeleft:timeleft_dev_password@localhost:5432/timeleft_shanghai?schema=public";

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
