import { z } from 'zod';

export const registerSchema = z.object({
  pseudo: z
    .string()
    .min(3, 'Le pseudo doit contenir au moins 3 caractères.')
    .max(30, 'Le pseudo ne peut pas dépasser 30 caractères.'),
  email: z.email('Saisis une adresse e-mail valide.'),
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
    .regex(/[A-Z]/, 'Ajoute au moins une lettre majuscule.')
    .regex(/[a-z]/, 'Ajoute au moins une lettre minuscule.')
    .regex(/\d/, 'Ajoute au moins un chiffre.')
    .regex(/[^A-Za-z0-9]/, 'Ajoute au moins un caractère spécial.'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
