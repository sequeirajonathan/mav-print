# MAV Print Agent

An Electron-based application that automatically prints shipping labels for orders from MAV Collectibles. The agent watches for new print jobs from the cloud and prints them automatically to the configured printer.

## Features

- 🔄 Automatic print job monitoring  
- 🏷️ Automatic label printing  
- 🔧 Configurable printer settings  
- 🔐 Secure agent identification  
- 🖨️ Support for multiple printers  
- 📝 Manual test printing  
- 🔍 Debug logging  
- ⚡ Real-time job status updates  

## Prerequisites

- Node.js (v14 or higher)  
- npm (v6 or higher)  
- A compatible label printer  
- Windows, macOS, or Linux operating system  

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/mav-print.git
   cd mav-print
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.template`:
   ```bash
   cp .env.template .env
   ```

4. Configure your environment variables in `.env`:
   ```env
   AGENT_ID=your-agent-id
   PRINTER_NAME=your-printer-name
   SUPABASE_URL=your-supabase-url
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-key
   APP_URL=http://localhost:3000/print-agent
   DEBUG=false
   ```

## Development

1. Start the development server:
   ```bash
   npm run start
   ```

2. Build the application:
   ```bash
   npm run build
   ```

3. Package the application:
   ```bash
   npm run make-win
   ```

## Configuration

### Agent ID
Each agent instance requires a unique identifier. The system automatically appends a UUID to your agent ID to ensure uniqueness across multiple installations.

### Printer Settings
- Configure your default printer in the settings  
- Test print functionality available in the menu  
- Support for multiple printer configurations  

### Environment Variables
- `AGENT_ID`: Your agent identifier  
- `PRINTER_NAME`: Default printer name  
- `SUPABASE_URL`: Supabase project URL  
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key  
- `APP_URL`: Application URL  
- `DEBUG`: Enable/disable debug logging  

## Usage

1. Launch the application  
2. Configure your settings if prompted  
3. The agent will automatically:  
   - Connect to the cloud service  
   - Monitor for new print jobs  
   - Print labels when jobs are received  
   - Update job status  

### Manual Operations

- **Test Print**: Use the menu option to print a test label  
- **Upload PDF**: Manually upload and print PDF files  
- **Settings**: Configure agent and printer settings  
- **View Logs**: Access debug logs when enabled  

## 🛡️ Self-Signing for Windows (Internal Use Only)

If you're using this app internally on a Windows machine and want to avoid Windows Defender and SmartScreen warnings, you can self-sign your executable:

### 1. Create a Self-Signed Certificate

```powershell
New-SelfSignedCertificate `
  -Type CodeSigning `
  -Subject "CN=MavPrintAgent" `
  -CertStoreLocation "C:\certs\mavprintagent.pfx" `
  -KeyExportPolicy Exportable `
  -KeySpec Signature `
  -KeyLength 2048 `
  -HashAlgorithm sha256 `
  -NotAfter (Get-Date).AddYears(5)
```

### 2. Export the Certificate to `.pfx`

1. Open cmd `certmgr.msc`  
2. Navigate to `Certificates - Current User > Personal > Certificates`  
3. Find `CN=MavPrintAgent`, right-click → All Tasks → Export  
4. Export as `.pfx` with private key and password  
5. Save to `C:\certs\mavprintagent.pfx`  

### 3. Sign the Application

Find the full path to `signtool.exe` (e.g., from the Windows SDK) and run:

```powershell
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe" sign `
  /f "C:\certs\mavprintagent.pfx" `
  /p yourPfxPassword `
  /tr http://timestamp.digicert.com `
  /td sha256 `
  /fd sha256 `
  "C:\Path\To\MAV.Print.Agent.Setup.1.0.0.exe"
```

### 4. (Optional) Trust the Certificate Locally

To suppress SmartScreen:

1. Double-click the `.pfx`  
2. Choose **Install Certificate**  
3. Select **Local Machine**  
4. Place it in **Trusted Root Certification Authorities**  

---

## Troubleshooting

1. **Printer Not Found**
   - Verify printer is connected and powered on  
   - Check printer name in settings  
   - Try test print from menu  

2. **Connection Issues**
   - Verify internet connection  
   - Check Supabase credentials  
   - Review debug logs  

3. **Print Job Issues**
   - Check printer status  
   - Verify label format  
   - Review job status in database  

## Contributing

1. Fork the repository  
2. Create your feature branch (`git checkout -b feature/amazing-feature`)  
3. Commit your changes (`git commit -m 'Add some amazing feature'`)  
4. Push to the branch (`git push origin feature/amazing-feature`)  
5. Open a Pull Request  

## License

This project is proprietary software. All rights reserved.

## Support

For support, please contact MAV Collectibles support team.

## Acknowledgments

- Electron  
- Supabase  
- pdf-to-printer  
- TypeScript  
