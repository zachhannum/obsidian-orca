import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `eyebrow` is the group the page sits in, set over the title.
    schema: docsSchema({ extend: z.object({ eyebrow: z.string().optional() }) }),
  }),
};
