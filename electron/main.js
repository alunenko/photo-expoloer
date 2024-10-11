const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win;
let serverProcess;

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');

    // Handle window close events
    win.on('close', (event) => {
        const choice = require('electron').dialog.showMessageBoxSync(win, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        });
        if (choice === 1) {
            event.preventDefault(); // Stops the window from closing
        }
    });

    win.on('closed', () => {
        win = null;  // Cleanup after the window is fully destroyed
    });
}

app.whenReady().then(() => {
    // Start the server.js in the background
    console.log('Starting server at:', path.join(__dirname, 'index.js'));
    serverProcess = spawn('node', [path.join(__dirname, 'index.js')], {
        stdio: 'inherit'
    });

    serverProcess.on('error', (err) => {
        console.error('Failed to start server:', err);
    });

    createWindow();  // Create the window after starting the server
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
    if (serverProcess) {
        serverProcess.kill();  // Terminate the server when the app is closed
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
