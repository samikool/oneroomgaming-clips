CREATE VIRTUAL TABLE `clip_search` USING fts5(
  `clip_id` UNINDEXED,
  `title`,
  `game`,
  `tags`,
  `people`,
  `comments`,
  tokenize = "unicode61 remove_diacritics 2"
);
