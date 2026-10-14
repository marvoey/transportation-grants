import axios from 'axios';
import { createWriteStream, createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { Extract } from 'unzipper';
import { parseStringPromise } from 'xml2js';
import { logger } from '../config/config.js';
import { SAMOpportunity } from '../types/index.js';

const GRANTS_GOV_BASE_URL = 'https://www.grants.gov/xml-extract';
const DATA_DIR = join(process.cwd(), 'data');
const EXTRACT_DIR = join(DATA_DIR, 'extract');
const JSON_FILE = join(DATA_DIR, 'dot-grants.json');

/**
 * Download and extract Grants.gov daily XML file
 */
export async function downloadGrantsExtract(): Promise<string> {
  logger.info('Downloading Grants.gov XML extract...');

  // Create data directories
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(EXTRACT_DIR, { recursive: true });

  // Get today's date for filename
  const today = new Date();
  const dateStr = formatDateForFilename(today);

  // Try today, yesterday, and day before (in case today's file isn't ready)
  for (let daysBack = 0; daysBack < 3; daysBack++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysBack);
    const filename = `GrantsDBExtract${formatDateForFilename(date)}v2.zip`;
    const url = `${GRANTS_GOV_BASE_URL}/${filename}`;
    const zipPath = join(DATA_DIR, filename);

    try {
      logger.info(`Trying to download: ${url}`);

      // Download ZIP file
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 300000, // 5 minutes
      });

      await pipeline(response.data, createWriteStream(zipPath));
      logger.info(`Downloaded: ${filename} (${(await fs.stat(zipPath)).size / 1024 / 1024} MB)`);

      return zipPath;
    } catch (error: any) {
      logger.warn(`Failed to download ${filename}: ${error.message}`);
      if (daysBack === 2) {
        throw new Error('Could not download Grants.gov extract from last 3 days');
      }
    }
  }

  throw new Error('Failed to download Grants.gov extract');
}

/**
 * Extract ZIP file
 */
export async function extractZipFile(zipPath: string): Promise<string> {
  logger.info('Extracting ZIP file...');

  const extractPath = join(EXTRACT_DIR, 'latest');
  await fs.rm(extractPath, { recursive: true, force: true });
  await fs.mkdir(extractPath, { recursive: true });

  await pipeline(
    createReadStream(zipPath),
    Extract({ path: extractPath })
  );

  // Find the XML file
  const files = await fs.readdir(extractPath);
  const xmlFile = files.find(f => f.endsWith('.xml'));

  if (!xmlFile) {
    throw new Error('No XML file found in extract');
  }

  const xmlPath = join(extractPath, xmlFile);
  logger.info(`Extracted XML: ${xmlFile}`);

  return xmlPath;
}

/**
 * Parse XML and extract DOT grants
 */
export async function parseDOTGrants(xmlPath: string): Promise<any[]> {
  logger.info('Parsing XML for DOT grants...');

  const xmlContent = await fs.readFile(xmlPath, 'utf-8');
  const parsed = await parseStringPromise(xmlContent);

  // Navigate the XML structure (adjust based on actual structure)
  const grants = parsed?.Grants?.Grant || [];

  logger.info(`Total grants in XML: ${grants.length}`);

  // Filter for DOT grants
  const dotGrants = grants.filter((grant: any) => {
    const agency = grant.AgencyName?.[0] || '';
    return agency.toLowerCase().includes('transportation');
  });

  logger.info(`DOT grants found: ${dotGrants.length}`);

  // Convert to our format
  const converted = dotGrants.map((grant: any) => convertXMLToOpportunity(grant));

  return converted;
}

/**
 * Convert XML grant to SAMOpportunity format
 */
function convertXMLToOpportunity(xmlGrant: any): SAMOpportunity {
  return {
    noticeId: xmlGrant.OpportunityID?.[0] || '',
    title: xmlGrant.OpportunityTitle?.[0] || '',
    department: xmlGrant.AgencyName?.[0] || '',
    subTier: xmlGrant.AgencyCode?.[0] || '',
    office: xmlGrant.OfficeLocation?.[0] || '',
    postedDate: xmlGrant.PostDate?.[0] || '',
    responseDeadLine: xmlGrant.CloseDate?.[0] || '',
    description: xmlGrant.Description?.[0] || '',
    award: {
      amount: xmlGrant.AwardAmount?.[0] || '',
    },
    uiLink: `https://www.grants.gov/search-results-detail/${xmlGrant.OpportunityID?.[0]}`,
  };
}

/**
 * Save DOT grants to JSON file
 */
export async function saveDOTGrants(grants: any[]): Promise<void> {
  await fs.writeFile(JSON_FILE, JSON.stringify(grants, null, 2));
  logger.info(`Saved ${grants.length} DOT grants to ${JSON_FILE}`);
}

/**
 * Load DOT grants from JSON file
 */
export async function loadDOTGrants(): Promise<any[]> {
  try {
    const content = await fs.readFile(JSON_FILE, 'utf-8');
    const grants = JSON.parse(content);
    logger.info(`Loaded ${grants.length} DOT grants from cache`);
    return grants;
  } catch (error) {
    logger.warn('No cached grants found');
    return [];
  }
}

/**
 * Complete update process
 */
export async function updateGrantsDatabase(): Promise<void> {
  logger.info('Starting Grants.gov database update...');

  try {
    // Download
    const zipPath = await downloadGrantsExtract();

    // Extract
    const xmlPath = await extractZipFile(zipPath);

    // Parse
    const dotGrants = await parseDOTGrants(xmlPath);

    // Save
    await saveDOTGrants(dotGrants);

    logger.info('Grants database updated successfully!');
  } catch (error) {
    logger.error('Failed to update grants database:', error);
    throw error;
  }
}

/**
 * Format date for filename (YYYYMMDD)
 */
function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Check if data needs update (older than 1 day)
 */
export async function needsUpdate(): Promise<boolean> {
  try {
    const stats = await fs.stat(JSON_FILE);
    const ageMs = Date.now() - stats.mtimeMs;
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours > 24;
  } catch {
    return true; // File doesn't exist, needs update
  }
}
