-- Extension cho tìm kiếm tiếng Việt không dấu (unaccent + pg_trgm) và so khớp không phân biệt hoa thường.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
