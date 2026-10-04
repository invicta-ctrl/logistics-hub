-- Automatic suggestions are computed; only a staff choice needs storage.
ALTER TABLE items ADD COLUMN visual_type TEXT CHECK (visual_type IN ('SYSTEM_ICON', 'PHOTO'));
ALTER TABLE items ADD COLUMN icon_key TEXT CHECK (icon_key IS NULL OR (length(icon_key) BETWEEN 8 AND 80 AND icon_key GLOB 'tabler:*'));
