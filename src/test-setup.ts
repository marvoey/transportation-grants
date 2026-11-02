// The logger calls getConfig(), which requires SAM_API_KEY. Tests never hit external APIs.
process.env.SAM_API_KEY = process.env.SAM_API_KEY || 'test-sam-key';
process.env.LOG_LEVEL = 'error';
process.env.DATA_SOURCE = 'mock';
