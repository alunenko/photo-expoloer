const express = require('express');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const util = require('util');
const EventEmitter = require('events');
const { WebSocketServer } = require('ws');
const { spawn} = require('child_process');

const app = express();
const port = 3000;

let currentSourceFolder = '';

app.use(express.json());

const ErrorCodes = Object.freeze({
    FILE_ALREADY_EXISTS_AND_ITS_IDENTICAL: 1,
});

// Enable CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:8080'); // Update with the correct origin of your HTML page
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.post('/processFiles', (req, res) => {
    currentSourceFolder = req.body.sourceFolder;
    const {outputFolder, videoFolder} = req.body;

    if (!currentSourceFolder || !outputFolder) {
        return res.status(400).json({error: 'Both sourceFolder and outputFolder are required.'});
    }

    // Read files in the source folder
    fs.readdir(currentSourceFolder, async (err, files) => {
        if (err) {
            return res.status(500).json({error: 'Error reading source folder.'});
        }

        // Process each file
        const processedFiles = await Promise.all(
            files.filter((fileName) => {
                return fileName.match(/\.(jpg|jpeg|png|dng|mp4|mov)$/i);
            }).map(async (fileName) => {
                let result = {};
                let output_path = '';
                const extension = path.extname(fileName);
                const {year, month, day, hours, minutes, seconds, isBlob} = parseFileName(fileName);

                if ((extension === '.mp4' || extension === '.mov') && videoFolder) {
                    output_path = `${year} video/`;
                } else {
                    output_path = path.join(`${year}.${month}`, `${year}.${month}.${day}`);
                }

                result = {
                    origin_name: fileName,
                    path: {
                        year,
                        month,
                        day,
                        hours,
                        minutes,
                        seconds,
                        extension
                    },
                    source_path_log: path.join(currentSourceFolder, fileName),
                    source_path: currentSourceFolder,
                    output_path_log: path.join(outputFolder, year, output_path, fileName),
                    output_path: path.join(outputFolder, year, output_path),
                }

                if (isBlob) {
                    result.blob = await getImageBlob(path.join(currentSourceFolder, fileName));
                }

                // console.log(result.origin_name, result.output_path_log);

                return result;
            })
        );

        const totalFiles = processedFiles.length;

        res.json({totalFiles, files: processedFiles});
    })
});

app.post('/moveFile', (req, res) => {
    const {file} = req.body;

    let result = {
        success: false
    };

    // Check if the destination file already exists
    fsExtra.pathExists(file.output_path_log, async (err, exists) => {
        if (err) {
            console.error(`Error checking file existence: ${err.message}`);
            result.message = err.message;
            return res.json(result);
        } else {
            if (exists) {
                if (areFilesEqual(file.source_path_log, file.output_path_log)) {
                    const message = `File ${file.output_path_log} already exists and is identical.`;
                    console.log(message);
                    result.message = message;
                    result.error_code = ErrorCodes.FILE_ALREADY_EXISTS_AND_ITS_IDENTICAL;
                    return res.json(result);
                } else {
                    let message = `File ${file.output_path_log} already exists and is different.`;
                    console.log(message);

                    // If the file already exists, generate a unique name for the destination
                    // const timestamp = new Date().toISOString().replace(/:/g, '-');
                    const filesInCurrentFolder = await fs.promises.readdir(path.dirname(file.output_path_log)); // actually, we need to find files with the same name
                    const filePostfix = filesInCurrentFolder.length + 1 < 10 ? `0${filesInCurrentFolder.length + 1}` : filesInCurrentFolder.length + 1;
                    // file.output_path_log -> //Volumes/MyPassport/test/2021/2021.02/2021.02.01/2021-02-01 01.jpg
                    const oldFileName = path.basename(file.output_path_log, path.extname(file.output_path_log));
                    // const output_path_new_filename = path.join(path.dirname(file.output_path_log), `${oldFileName}.${timestamp}${path.extname(file.output_path_log)}`); // will create a new file which is probably already there
                    const output_path_new_filename = path.join(path.dirname(file.output_path_log), `${oldFileName} ${filePostfix}${path.extname(file.output_path_log)}`); // will create a new file which is probably already there
                    // console.log(output_path_new_filename);
                    file.output_path_log = output_path_new_filename;

                    const messageMoveFile = await moveFile(file);
                    result.success = true;
                    result.message = `${message}`;
                    return res.json(result);
                }
            } else {
                let message = `File ${path.basename(file.output_path_log, path.extname(file.output_path_log))} does not exist on ${file.output_path_log}.`;
                console.log(message);
                const messageMoveFile = await moveFile(file);
                result.success = messageMoveFile.success;
                result.message = `${message};${err || ''};${messageMoveFile.message}`;
                return res.json(result);
            }
        }
    });
});

app.post('/removeFile', (req, res) => {
    const {file} = req.body;
    let result = {
        success: false
    };

    fsExtra.remove(file.source_path_log, async (err) => {
        if (err) {
            console.error(`Error removing file: ${err.message}`);
            result.message = err.message;
            return res.json(result);
        } else {
            console.log(`File ${file.source_path_log} removed successfully.`);
            result.success = true;
            return res.json(result);
        }
    });
});

app.post('/getBlobImage', async (req,res) => {
    return res.json({blob: await getImageBlob(req.body.src)});
});

app.post('/dotClean', async (req,res) => {
    await dotClean(req.body.path);
    return res.json({"success": true});
});

function areFilesEqual(path1, path2) {
    try {
        const content1 = fs.readFileSync(path1, 'utf-8');
        const content2 = fs.readFileSync(path2, 'utf-8');
        return content1 === content2;
    } catch (error) {
        // Handle errors such as file not found, permission issues, etc.
        console.error(`Error comparing files: ${error.message}`);
        return false;
    }
}

// Function to parse the file name and extract year, month, and day
function parseFileName(fileName) {
    const fnbasedOnDateRegex = /(?:(\d{4})-(\d{2})-(\d{2})(?: (\d{2})\.(\d{2})\.(\d{2}))?|IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})|Collage_(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2})(\d{2}))?_.*|collage_(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2})(\d{2}))?_.*|(\d{4})\.(\d{2})\.(\d{2})|(\d{8})_(\d{6})|IMG-(\d{8})-WA(\d+)|(\d{8})_(\d{6}))/;

    const match = fileName.match(fnbasedOnDateRegex); // fileNameBasedOnDateRegex
    let dateGroups;

    if (match) {
        dateGroups = match.slice(1).filter(Boolean); // Filter out undefined groups
        // console.log(`Match found for ${fileName}: ${dateGroups}`);
    } else {
        // console.log(`No match found for ${fileName}`);
    }

    const minYear = 1900;
    const maxYear = new Date().getFullYear();
    const minMonth = 1;
    const maxMonth = 12;
    const minDay = 1;
    const maxDay = 31;

    return {
        year: (dateGroups && (dateGroups[0] >= minYear && dateGroups[0] <= maxYear)) ? dateGroups[0] : '0000',
        month: (dateGroups && (dateGroups[1] >= minMonth && dateGroups[1] <= maxMonth)) ? dateGroups[1] : '00',
        day: (dateGroups && (dateGroups[2] >= minDay && dateGroups[2] <= maxDay)) ? dateGroups[2] : '00',
        hours: dateGroups && dateGroups[3] ? dateGroups[3] : '00',
        minutes: dateGroups && dateGroups[4] ? dateGroups[4] : '00',
        seconds: dateGroups && dateGroups[5] ? dateGroups[5] : '00',
        isBlob: match === null
    };
}

async function getImageBlob(path) {
    let base64Data = null;

    try {
        // Read the image file synchronously
        const data = fs.readFileSync(path);

        // Convert the binary data to Base64-encoded string
        base64Data = Buffer.from(data).toString('base64');
    } catch (err) {
        console.error('Error reading the file:', err);
    }

    // console.log(path);
    return base64Data;
}

async function moveFile(file) {
    const moveFileAsync = util.promisify(fsExtra.move);
    let result = {
        success: false
    };

    try {
        await moveFileAsync(file.source_path_log, file.output_path_log);
        const message = `File moved from ${file.source_path_log} to ${file.output_path_log} successfully`;
        console.log(message);
        result.success = true;
        result.message = message;
    } catch (err) {
        const message = `Error moving file: ${err.message}`;
        console.error(message);
        result.message = `${message}; ${err.message}`;
    }

    return result;
}

async function dotClean(path) {
    // Execute dot_clean command with arguments
    const dotCleanProcess = spawn('dot_clean', [path]);

    dotCleanProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    dotCleanProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    dotCleanProcess.on('close', (code) => {
        console.log(`dot_clean process exited with code ${code}`);
    });

    dotCleanProcess.on('error', (err) => {
        console.error(`Error executing dot_clean: ${err}`);
    });
}

<!--region ScanFolder-->
const webSocetPort = 4200;

class FolderScanner extends EventEmitter {
    async scanDirectory(dir) {
        return new Promise(resolve => {
            console.log(`Scanning directory: ${dir}`);
            fs.readdir(dir, { withFileTypes: true }, async (err, dirs) => {
                if (err) {
                    this.emit('error', { message: err.message, stack: err.stack });
                    console.error(`Error reading directory ${dir}:`, err);
                    return;
                }
                await Promise.all(
                    dirs.map(async (item) => {
                        const itemPath = path.join(dir, item.name);
                        if (item.isDirectory()) {
                            const result = { name: item.name, type: 'directory', path: itemPath };
                            // console.log(result);
                            this.emit('progress', result);
                            // Recursively scan subdirectories
                            await this.scanDirectory(itemPath);
                        } else {
                            // const result = { name: item.name, type: 'file', path: itemPath, ext: path.extname(item.name) };
                            const extension = path.extname(item.name);
                            const {year, month, day, hours, minutes, seconds, isBlob} = parseFileName(item.name);

                            const result = {
                                origin_name: item.name,
                                path: {
                                    year,
                                    month,
                                    day,
                                    hours,
                                    minutes,
                                    seconds,
                                    extension
                                },
                                source_path_log: itemPath
                            };
                            // console.log(result);
                            this.emit('progress', result);
                        }
                    })
                ).catch((err) => {
                    this.emit('error', {message: err.message, stack: err.stack});
                });

                resolve();
            });
        });
    }

    async startScan(rootPath) {
        this.emit('start', { path: rootPath });
        console.log('Scanning started...');
        await this.scanDirectory(rootPath);
        this.emit('end', { path: rootPath });
        console.log('Scanning ended.');
    }
}

// WebSocket server setup
const server = new WebSocketServer({ port: webSocetPort });

server.on('connection', (ws) => {
    console.log('Client connected');
    const folderScanner = new FolderScanner();

    folderScanner.on('progress', (data) => {
        ws.send(JSON.stringify({ type: 'progress', data }));
    });

    folderScanner.on('error', (error) => {
        ws.send(JSON.stringify({ type: 'error', error }));
    });

    folderScanner.on('start', (data) => {
        ws.send(JSON.stringify({ type: 'start', data }));
    });

    folderScanner.on('end', (data) => {
        ws.send(JSON.stringify({ type: 'end', data }));
    });

    ws.on('message', (message) => {
        const { type, path } = JSON.parse(message);
        if (type === 'startScan') {
            folderScanner.startScan(path);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});
<!--endregion-->

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
