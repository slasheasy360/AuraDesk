# Skill: Prisma Schema Generator

When generating Prisma schemas:

Requirements:

- Use UUID as primary keys
- Use proper relations
- Use indexed fields for platform IDs
- Include timestamps
- Use enums where applicable

Example:

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
}

Relationships must be explicitly defined.

Avoid circular dependencies.