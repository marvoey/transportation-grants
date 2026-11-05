// Unit tests never use real credentials or the network. config.ts needs
// SAM_API_KEY at load time (logger -> getConfig), so give every worker dummy
// values, overriding anything dotenv or the shell provides.
process.env.SAM_API_KEY = 'test-sam-key';
process.env.SIMPLER_GRANTS_API_KEY = 'test-simpler-key';
process.env.LOG_LEVEL = 'error';
