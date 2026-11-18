import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { updateCategories } from './data/update-categories';

const updates = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/updates' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    published: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    publishedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    category: z.enum(updateCategories),
  }),
});

export const collections = { updates };

