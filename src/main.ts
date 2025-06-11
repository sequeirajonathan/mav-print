import * as dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import { getSupabaseClient, initializeSupabase } from './supabase';
import { PrintCommand, PrintJob, PrintJobUpdate } from './types';
import fs from 'fs';
import os from 'os';
import { print as directPrint, getPrinters } from 'pdf-to-printer';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import { debugLog } from './debug';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// Load environment variables from the appropriate location
const envPath = app.isPackaged 
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../.env');

// Settings file path
const settingsPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'settings.json')
  : path.join(__dirname, '../settings.json');

// Load initial environment variables
dotenv.config({ path: envPath });

// Function to generate or load unique agent ID
function getUniqueAgentId(baseAgentId: string): string {
  const uniqueIdPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'unique-agent-id')
    : path.join(__dirname, '../unique-agent-id');

  try {
    // Try to load existing unique ID
    if (fs.existsSync(uniqueIdPath)) {
      const uniqueId = fs.readFileSync(uniqueIdPath, 'utf8');
      return `${baseAgentId}-${uniqueId}`;
    }

    // Generate new unique ID if none exists
    const uniqueId = uuidv4();
    fs.writeFileSync(uniqueIdPath, uniqueId);
    return `${baseAgentId}-${uniqueId}`;
  } catch (error) {
    debugLog('Error handling unique agent ID:', error);
    // Fallback to timestamp-based ID if file operations fail
    return `${baseAgentId}-${Date.now()}`;
  }
}

// Load or create settings file
function loadSettingsFile() {
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      // If we have a base agent ID, generate the unique version
      if (settings.AGENT_ID) {
        settings.UNIQUE_AGENT_ID = getUniqueAgentId(settings.AGENT_ID);
      }
      return settings;
    }
    return {};
  } catch (error) {
    console.error('Error loading settings file:', error);
    return {};
  }
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
const settings = loadSettingsFile();
const agentId = settings.AGENT_ID || process.env.AGENT_ID || 'agent-unknown';
const defaultPrinterName = settings.PRINTER_NAME || process.env.PRINTER_NAME;
let supabaseClient: ReturnType<typeof getSupabaseClient> | null = null;

let isPrinting = false;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Function to initialize Supabase client with retry
async function initializeSupabaseWithRetry(): Promise<boolean> {
  try {
    supabaseClient = await initializeSupabase();
    if (!supabaseClient) {
      debugLog('Failed to initialize Supabase client');
      return false;
    }
    return true;
  } catch (error) {
    debugLog('Error initializing Supabase:', error);
    return false;
  }
}

// Function to check if required settings are configured
function areSettingsConfigured(): boolean {
  const currentSettings = loadSettingsFile();
  return !!(
    currentSettings.AGENT_ID && 
    currentSettings.PRINTER_NAME && 
    currentSettings.SUPABASE_URL && 
    currentSettings.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Function to handle initial setup
async function handleInitialSetup() {
  // If settings are not configured, show settings window
  if (!areSettingsConfigured()) {
    createSettingsWindow(true);
    return false;
  }

  // Initialize Supabase client
  const initialized = await initializeSupabaseWithRetry();
  if (!initialized) {
    createErrorWindow('Failed to connect to database. Please check your settings and try again.');
    return false;
  }

  return true;
}

// Function to validate agent ID format
function validateAgentId(agentId: string): { isValid: boolean; error?: string } {
  if (!agentId) {
    return { isValid: false, error: 'Agent ID is required' };
  }
  
  // Agent ID should be alphanumeric with optional hyphens and underscores
  const agentIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
  if (!agentIdRegex.test(agentId)) {
    return { 
      isValid: false, 
      error: 'Agent ID must start with a letter or number and can only contain letters, numbers, hyphens, and underscores' 
    };
  }

  // Agent ID should be between 3 and 50 characters
  if (agentId.length < 3 || agentId.length > 50) {
    return { 
      isValid: false, 
      error: 'Agent ID must be between 3 and 50 characters' 
    };
  }

  return { isValid: true };
}

// Function to check if agent ID is already in use
async function isAgentIdInUse(agentId: string): Promise<boolean> {
  if (!supabaseClient) {
    debugLog('Supabase client not initialized');
    return false;
  }

  try {
    const { data, error } = await supabaseClient
      .from('print_jobs')
      .select('claimed_by')
      .eq('claimed_by', agentId)
      .limit(1);

    if (error) {
      debugLog('Error checking agent ID:', error);
      return false;
    }

    return data && data.length > 0;
  } catch (error) {
    debugLog('Error checking agent ID:', error);
    return false;
  }
}

// Function to save settings with validation
async function saveSettings(newSettings: Record<string, string>) {
  try {
    // Validate agent ID if it's being changed
    if (newSettings.AGENT_ID && newSettings.AGENT_ID !== settings.AGENT_ID) {
      const validation = validateAgentId(newSettings.AGENT_ID);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Generate unique agent ID
      newSettings.UNIQUE_AGENT_ID = getUniqueAgentId(newSettings.AGENT_ID);
    }

    // Validate other required settings
    if (!newSettings.PRINTER_NAME) {
      throw new Error('Printer name is required');
    }
    if (!newSettings.SUPABASE_URL) {
      throw new Error('Supabase URL is required');
    }
    if (!newSettings.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase service role key is required');
    }

    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    // Reload settings
    Object.assign(settings, newSettings);
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error saving settings' 
    };
  }
}

// Function to get current settings
function getSettings() {
  return {
    AGENT_ID: settings.AGENT_ID || process.env.AGENT_ID || '',
    UNIQUE_AGENT_ID: settings.UNIQUE_AGENT_ID || '',
    PRINTER_NAME: settings.PRINTER_NAME || process.env.PRINTER_NAME || '',
    SUPABASE_URL: settings.SUPABASE_URL || process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: settings.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    APP_URL: settings.APP_URL || process.env.APP_URL || 'http://localhost:3000/print-agent',
    DEBUG: settings.DEBUG || process.env.DEBUG || 'false'
  };
}

function createSettingsWindow(isInitialSetup: boolean = false) {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    title: isInitialSetup ? 'MAV Print Agent Initial Setup' : 'MAV Print Agent Settings',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // Make the window modal but always closable
    modal: isInitialSetup,
    closable: true
  });

  // Add error handling for settings window
  settingsWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    debugLog('Settings window failed to load:', errorDescription);
    createErrorWindow(`Failed to load settings page. Error: ${errorDescription}`);
  });

  settingsWindow.loadURL(
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:3000/settings'
      : `file://${path.join(__dirname, '../settings.html')}`
  );

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // If this was initial setup and settings are now configured, start the main window
    if (isInitialSetup && areSettingsConfigured()) {
      createWindow();
      subscribeToPrintJobs();
      processNextJob();
    }
  });
}

function createErrorWindow(message: string) {
  const errorWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  errorWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 20px;
          text-align: center;
          background-color: #f5f5f5;
        }
        .error-container {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-top: 40px;
        }
        h1 { color: #e74c3c; }
        button {
          background-color: #3498db;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 20px;
        }
        button:hover {
          background-color: #2980b9;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>Connection Error</h1>
        <p>${message}</p>
        <button onclick="window.location.reload()">Retry Connection</button>
      </div>
    </body>
    </html>
  `));
}

async function checkUrlAccessibility(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../assets/mav_collectibles.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const appUrl = process.env.APP_URL || 'http://localhost:3000/print-agent';
  
  try {
    const isAccessible = await checkUrlAccessibility(appUrl);
    if (!isAccessible) {
      throw new Error(`Cannot connect to ${appUrl}`);
    }
    
    await mainWindow.loadURL(appUrl);
    
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  } catch (error) {
    debugLog('Failed to load URL:', error);
    createErrorWindow(`Unable to connect to ${appUrl}. Please check your internet connection and try again.`);
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    debugLog('Failed to load:', errorDescription);
    createErrorWindow(`Failed to load ${appUrl}. Error: ${errorDescription}`);
  });
}

function setAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          click: () => {
            if (!settingsWindow) {
              createSettingsWindow();
            } else {
              settingsWindow.focus();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => { mainWindow?.reload(); }
        },
        {
          label: 'Open DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow && mainWindow.isFocused()) {
              mainWindow.webContents.openDevTools();
            } else if (settingsWindow) {
              settingsWindow.webContents.openDevTools();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Print Test Label',
          click: () => {
            const testLabelUrl = 'https://rollo-main.b-cdn.net/wp-content/uploads/2017/01/Labels-Sample.pdf';
            printPdfLabel(testLabelUrl, { printerName: defaultPrinterName, silent: true });
          }
        },
        {
          label: 'Upload PDF to Print',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
            });
            if (!canceled && filePaths.length > 0) {
              printPdfLabel(`file://${filePaths[0]}`, { printerName: defaultPrinterName, silent: false });
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show README/About',
          click: () => {
            const readmeWindow = new BrowserWindow({
              width: 600,
              height: 600,
              title: 'About MAV Print Agent',
              webPreferences: { nodeIntegration: false }
            });
            readmeWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
              <h1>MAV Print Agent</h1>
              <p>This application automatically prints shipping labels for orders from MAV Collectibles.</p>
              <ul>
                <li>Watches for new print jobs from the cloud</li>
                <li>Prints labels automatically to the configured printer</li>
                <li>Allows manual test prints and PDF uploads</li>
              </ul>
              <p>For more info, visit <a href="https://www.mavcollectibles.com" target="_blank">mavcollectibles.com</a></p>
            `));
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function printPdfLabel(labelUrl: string, options: { printerName?: string; silent?: boolean }) {
  debugLog('Starting printPdfLabel with:', { labelUrl, options });
  
  if (!labelUrl) throw new Error('Label URL is required');

  const printerName = options.printerName || defaultPrinterName;
  debugLog('Using printer:', printerName);
  
  if (!printerName) throw new Error('No printer name provided and no default printer set in .env');

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `label-${Date.now()}.pdf`);
  debugLog('Temporary file path:', tempFile);

  try {
    debugLog('Downloading PDF from URL:', labelUrl);
    const response = await axios.get(labelUrl, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);
    fs.writeFileSync(tempFile, pdfBuffer);
    debugLog('PDF downloaded and saved to temp file');

    if (options.silent) {
      debugLog('Printing silently to printer:', printerName);
      await directPrint(tempFile, {
        printer: printerName
      });
      debugLog('Silent print completed');
      return;
    }

    const printWindow = new BrowserWindow({
      show: true,
      width: 1200,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const pdfPrintHtmlPath = path.join(__dirname, '../pdf-print.html');
    const pdfPrintUrl = `file://${pdfPrintHtmlPath}?file=${encodeURIComponent(tempFile)}`;

    printWindow.webContents.on('console-message', (event, level, message) => {
      debugLog('PDF Window Console:', message);
    });

    await printWindow.loadURL(pdfPrintUrl);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        printWindow?.close();
        reject(new Error('PDF rendering timeout'));
      }, 30000);

      const onConsole = (event: Electron.Event, level: number, message: string) => {
        if (message === 'pdf-rendered') {
          clearTimeout(timeout);
          printWindow.webContents.removeListener('console-message', onConsole);
          resolve(undefined);
        }
      };

      printWindow.webContents.on('console-message', onConsole);
    });

    // Add a small delay to ensure the PDF is fully rendered
    await new Promise(resolve => setTimeout(resolve, 1000));

    const printOptions = {
      silent: false,
      printBackground: true,
      deviceName: printerName,
      pageSize: {
        width: Math.floor(4 * 25400),
        height: Math.floor(6.5 * 25400)
      },
      margins: { marginType: 'none' as const },
      copies: 1,
      color: false,
      landscape: false
    };

    await new Promise((resolve, reject) => {
      printWindow.webContents.print(printOptions, (success, errorType) => {
        if (!success) {
          printWindow.close();
          reject(new Error(errorType || 'Print failed'));
        } else {
          // Add a small delay before closing the window to ensure print job is complete
          setTimeout(() => {
            printWindow.close();
            resolve(undefined);
          }, 500);
        }
      });
    });
  } finally {
    // Clean up the temporary file
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (error) {
      debugLog('Error cleaning up temporary PDF file:', error);
    }
  }
}

async function subscribeToPrintJobs() {
  if (!supabaseClient) {
    debugLog('Supabase client not initialized');
    const initialized = await initializeSupabaseWithRetry();
    if (!initialized || !supabaseClient) {
      debugLog('Failed to initialize Supabase client for subscription');
      return;
    }
  }

  try {
    const channel = supabaseClient
      .channel('print-jobs')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'print_jobs',
          filter: `status=eq.pending`
        },
        async (payload: PrintJobUpdate) => {
          debugLog('New print job received:', payload);
          await processNextJob();
        }
      );

    await channel.subscribe();
    debugLog('Subscribed to print jobs');
  } catch (error) {
    debugLog('Error setting up print job subscription:', error);
  }
}

async function tryClaimAndPrint(job: PrintJob) {
  if (!supabaseClient) {
    debugLog('Supabase client not initialized');
    return false;
  }

  try {
    const { data, error } = await supabaseClient
      .from('print_jobs')
      .update({ 
        status: 'printing',
        claimed_by: settings.UNIQUE_AGENT_ID,
        claimed_at: new Date().toISOString()
      })
      .eq('id', job.id)
      .eq('status', 'pending')
      .is('claimed_by', null)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        debugLog('Job already claimed by another agent');
        return false;
      }
      debugLog('Error claiming print job:', error);
      return false;
    }

    if (!data) {
      debugLog('Job not available for claiming');
      return false;
    }

    const printJob = data as unknown as PrintJob;
    await printPdfLabel(printJob.label_url, { printerName: defaultPrinterName, silent: true });
    return true;
  } catch (error) {
    debugLog('Error in tryClaimAndPrint:', error);
    return false;
  }
}

async function processNextJob() {
  if (!supabaseClient) {
    debugLog('Supabase client not initialized');
    return;
  }

  if (isPrinting) {
    debugLog('Already printing, skipping...');
    return;
  }

  try {
    const { data: jobs, error } = await supabaseClient
      .from('print_jobs')
      .select('*')
      .eq('status', 'pending')
      .is('claimed_by', null)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      debugLog('Error fetching print jobs:', error);
      return;
    }

    if (!jobs || jobs.length === 0) {
      debugLog('No pending print jobs');
      return;
    }

    const job = jobs[0] as unknown as PrintJob;
    isPrinting = true;

    try {
      const success = await tryClaimAndPrint(job);
      if (success) {
        const { error: updateError } = await supabaseClient
          .from('print_jobs')
          .update({ status: 'completed' })
          .eq('id', job.id);

        if (updateError) {
          debugLog('Error updating print job status:', updateError);
        }
      }
    } catch (error) {
      debugLog('Error processing print job:', error);
      retryCount++;

      if (retryCount < MAX_RETRIES) {
        debugLog('Retrying in', RETRY_DELAY/1000, 'seconds...');
        setTimeout(processNextJob, RETRY_DELAY);
      } else {
        debugLog('Max retries reached, giving up');
        retryCount = 0;
      }
    } finally {
      isPrinting = false;
    }
  } catch (error) {
    debugLog('Error in processNextJob:', error);
    isPrinting = false;
  }
}

ipcMain.on('print-command', async (event, command: PrintCommand) => {
  debugLog('Received print command:', command);
  
  if (!supabaseClient) {
    debugLog('Supabase client not initialized');
    event.reply('print-response', {
      success: false,
      message: 'Supabase client not initialized',
      error: 'Database connection not available'
    });
    return;
  }

  try {
    // Handle test prints differently
    if (command.orderId === 'TEST-PRINT') {
      debugLog('Processing test print command');
      const labelUrl = command.settings?.labelUrl || command.labelUrl;
      if (!labelUrl) {
        throw new Error('Label URL is required for test print');
      }

      debugLog('Test print settings:', {
        labelUrl,
        printerName: command.settings?.printerName || command.printerName || defaultPrinterName,
        silent: command.settings?.silent
      });

      await printPdfLabel(labelUrl, {
        printerName: command.settings?.printerName || command.printerName || defaultPrinterName,
        silent: command.settings?.silent
      });

      event.reply('print-response', { success: true, message: 'Test print completed successfully' });
      return;
    }

    // Handle regular print jobs
    const { data, error } = await supabaseClient
      .from('print_jobs')
      .update({
        status: 'printing',
        claimed_by: settings.UNIQUE_AGENT_ID,
        claimed_at: new Date().toISOString()
      })
      .eq('id', command.orderId)
      .eq('status', 'pending')
      .is('claimed_by', null)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        event.reply('print-response', {
          success: false,
          message: 'Job already claimed by another agent',
          error: 'Duplicate claim'
        });
        return;
      }
      throw error;
    }

    if (!data) {
      event.reply('print-response', {
        success: false,
        message: 'Job not available for claiming',
        error: 'Job not found or already claimed'
      });
      return;
    }

    const labelUrl = command.settings?.labelUrl || command.labelUrl;

    await printPdfLabel(labelUrl, {
      printerName: command.settings?.printerName || command.printerName || defaultPrinterName,
      silent: command.settings?.silent
    });

    await supabaseClient
      .from('print_jobs')
      .update({
        status: 'completed',
        printed_at: new Date().toISOString()
      })
      .eq('id', command.orderId);

    event.reply('print-response', { success: true, message: 'Print job completed successfully' });
  } catch (error) {
    event.reply('print-response', {
      success: false,
      message: 'Failed to process print job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add IPC handlers for settings
ipcMain.handle('get-settings', () => {
  return getSettings();
});

ipcMain.handle('save-settings', async (event, newSettings) => {
  return await saveSettings(newSettings);
});

// Add IPC handler for checking if settings are configured
ipcMain.handle('check-settings-configured', () => {
  return areSettingsConfigured();
});

// Add IPC handler for getting available printers
ipcMain.handle('get-available-printers', async () => {
  try {
    debugLog('Fetching available printers...');
    
    // Try Windows-specific command first
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('wmic printer get name');
        const printers = stdout
          .split(/\r?\n/)
          .slice(1)
          .map(line => line.trim())
          .filter(line => line.length > 0);
        debugLog('Found Windows printers:', printers);
        return printers;
      } catch (error) {
        debugLog('Error getting Windows printers:', error);
      }
    }
    
    // Fallback to pdf-to-printer
    const printers = await getPrinters();
    debugLog('Found printers from pdf-to-printer:', printers);
    return printers.map(printer => printer.name);
  } catch (error) {
    debugLog('Error getting printers:', error);
    return [];
  }
});

ipcMain.on('quit-app', () => {
  app.quit();
});

app.whenReady().then(async () => {
  setAppMenu();
  
  // Handle initial setup
  const isConfigured = await handleInitialSetup();
  
  if (isConfigured) {
    // Launch main window if already configured
    createWindow();
    await subscribeToPrintJobs();
    processNextJob();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
