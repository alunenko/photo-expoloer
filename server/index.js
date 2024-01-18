const express = require('express');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const util = require('util');

const app = express();
const port = 3000;

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
    const {sourceFolder, outputFolder, videoFolder} = req.body;

    if (!sourceFolder || !outputFolder) {
        return res.status(400).json({error: 'Both sourceFolder and outputFolder are required.'});
    }

    // Read files in the source folder
    fs.readdir(sourceFolder, (err, files) => {
        if (err) {
            return res.status(500).json({error: 'Error reading source folder.'});
        }

        // Process each file
        const processedFiles = files.filter((file) => {
            return file.match(/\.(jpg|mp4)$/i);
        }).map((file) => {
            let output_path = '';
            const extension = path.extname(file);
            const {year, month, day} = parseFileName(file);

            if (extension === '.mp4' && videoFolder) {
                output_path = `${year} video/`;
            } else {
                output_path = path.join(`${year}.${month}`, `${year}.${month}.${day}`);
            }

            return {
                origin_name: file,
                path: {
                    year,
                    month,
                    day,
                    extension
                },
                source_path_log: path.join(sourceFolder, file),
                source_path: sourceFolder,
                output_path_log: path.join(outputFolder, year, output_path, file),
                output_path: path.join(outputFolder, year, output_path),
            };
        });

        const totalFiles = processedFiles.length;

        res.json({totalFiles, files: processedFiles});
    });
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
                    const timestamp = new Date().toISOString().replace(/:/g, '-');
                    // file.output_path_log -> //Volumes/MyPassport/test/2021/2021.02/2021.02.01/2021-02-01 01.jpg
                    const oldFileName = path.basename(file.output_path_log, path.extname(file.output_path_log));
                    const output_path_new_filename = path.join(path.dirname(file.output_path_log), `${oldFileName}.${timestamp}${path.extname(file.output_path_log)}`); // will create a new file which is probably already there

                    const messageMoveFile = await moveFile(file, output_path_new_filename);
                    result.message = `${message}; ${err} ${messageMoveFile}`;
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
    const fnbasedOnDateRegex = /(?:(\d{4})-(\d{2})-(\d{2})|IMG_(\d{4})(\d{2})(\d{2})_|Collage_(\d{4})(\d{2})(\d{2})_|collage_(\d{4})(\d{2})(\d{2})_)/;
    const match = fileName.match(fnbasedOnDateRegex); // fileNameBasedOnDateRegex
    let dateGroups;

    if (match) {
        dateGroups = match.slice(1).filter(Boolean); // Filter out undefined groups
        console.log(`Match found for ${fileName}: ${dateGroups}`);
    } else {
        console.log(`No match found for ${fileName}`);
    }

    return {
        year: dateGroups ? dateGroups[0] : '0000',
        month: dateGroups ? dateGroups[1] : '00',
        day: dateGroups ? dateGroups[2] : '00'
    };
}

async function moveFile(file, output_path_new_filename) {
    const moveFileAsync = util.promisify(fsExtra.move);
    let result = {
        success: false
    };

    try {
        await moveFileAsync(file.source_path_log, output_path_new_filename || file.output_path_log);
        const message = `File moved from ${file.source_path_log} to ${output_path_new_filename || file.output_path_log} successfully`;
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

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
