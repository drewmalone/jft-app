// Explicit synthetic selection for server tests; production startup has no default.
process.env.STT_PROVIDER = 'openai';
