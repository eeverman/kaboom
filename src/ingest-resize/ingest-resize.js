const fs = require('fs');
const path = require( 'path' );
const { copyFile, replaceLastOrAdd } = require('../helpers/helpers.js');
const nConvert = require('./n-convert.js');
const primitive = require('./primitive.js');
const hydrateJSON = require('../hydrate/hydrate-json.js');
const getDirectoryName = require('./get-input-directory.js');
const { logIntro } = require('./ingest-resize-info.js');
const {
    APP_LOCAL_DIRECTORY,
    DEFAULT_IMAGE_DIRECTORY,
    GALLERY_MAIN_PATH
} = require('../constants.js');

const notAppDir = dir => dir !== APP_LOCAL_DIRECTORY;

const TRANSFORM_SIZES = {
    // microscopic: 'microscopic',
    tiny: 'tiny',
    small: 'small',
    medium: 'medium',
    large: 'large',
    svg: 'svg' // included to make sure "svg" directory is built
};

const transform = (size, source, destination, handleResults) => {

    const handleCopyResults = err => {
        if (err) {
            console.log('Copy File: error');
            console.log(err);
        } else {
            nConvert(size, destination, handleResults);
        }
    };

    copyFile(source, destination, handleCopyResults);
};

const batchTransform = async (size, remoteDir, successCallback) => {

    if (size === 'svg') { successCallback(size); return; }

    if (!TRANSFORM_SIZES[size]) {
        console.error('No handler for size: ' + size);
        return;
    }

    const destination = TRANSFORM_SIZES[size];
    const sourcePath = path.join(remoteDir, DEFAULT_IMAGE_DIRECTORY);
    const sourceImages = await fs.promises.readdir(sourcePath);

    let totalToProcess = 0;
    const successes = [];

    const handleTransformResults = destination => {
        successes.push(destination);

        console.log(
            size + ' conversion [ ' + 
            (successes.length < 10 ? ('0' + successes.length) : successes.length) +
             ' ] of ' + 
            totalToProcess + ':  ' 
            + destination);

        if (successes.length >= totalToProcess) {
            if (successCallback) { successCallback(size); }
        }
    };

    console.log(' ');
    console.log('---- Resize images: [ ' + size + ' ] ----');

    const goodTypes = {
        '.png': true,
        '.jpg': true,
        '.jpeg': true,
        '.gif': true
    };

    for(const imagePath of sourceImages) {

        const fromPath = path.join(sourcePath, imagePath);
        const stat = await fs.promises.stat(fromPath);

        if(stat.isFile()) {
            const imgExtension = path.extname(fromPath);

            if (goodTypes[imgExtension]) {
                totalToProcess++;
                const sizedFile = replaceLastOrAdd(imagePath, imgExtension, '--' + size + '.jpg');

                const destinationPath = path.join(remoteDir, destination, sizedFile);
                transform(size, fromPath, destinationPath, handleTransformResults);

            }
        }
    }
};

const buildSVG = async (albumPath, successCallback) => {
    const sourcePath = path.join(albumPath, DEFAULT_IMAGE_DIRECTORY);

    console.log('BUILD SVG', sourcePath);
    console.log('Be patient... SVG creation can take a while.');
    console.log(' ');

    const sourceImages = await fs.promises.readdir(sourcePath);

    const toProcess = [];
    let total = 0;
    let finished = 0;

    const goodTypes = {
        '.png': true,
        '.jpg': true,
        '.jpeg': true,
        '.gif': true
    };

    const handleConversionResults = (destination) => {
        if (destination) {
            finished++;
            console.log(
                'SVG [ ' + finished + ' ] of ' + total + ':  ' + destination
            );
        }

        if (toProcess.length) {
            const imagePath = toProcess.shift();
            const fromPath = path.join(sourcePath, imagePath);

            const imgExtension = path.extname(fromPath);

            const svgFile = replaceLastOrAdd(imagePath, imgExtension, '.svg');
            const destinationPath = path.join(albumPath, 'svg', svgFile);

            primitive(fromPath, destinationPath, handleConversionResults);
        } else {
            console.log(albumPath, ' ');
            console.log(albumPath, '-- all SVG images complete');
            successCallback(albumPath);
        }
    };    

    for(const imagePath of sourceImages) {
        const fromPath = path.join(sourcePath, imagePath);
        const stat = await fs.promises.stat(fromPath);

        if(stat.isFile()) {
            const imgType = path.extname(fromPath);
            if (goodTypes[imgType]) {
                toProcess.push(imagePath);
                total++;
            }
        }
    }

    handleConversionResults();
};

const albumTransform = async (albumPath, successCallback) => {

    const sizes = Object.values(TRANSFORM_SIZES);
    let svgBuildCalled = false;

    const transformNext = (priorSize) => {
        if (priorSize && priorSize !== 'svg') {
            console.log(albumPath, priorSize, 'conversions complete');
        }

        if (sizes.length) {
            const next = sizes.shift();
            batchTransform(next, albumPath, transformNext);

        } else {
            if (!svgBuildCalled) {
                svgBuildCalled = true;

                console.log(' ');
                console.log(albumPath, 'ALL CONVERSIONS COMPLETE');
                console.log(' ');

                buildSVG(albumPath, successCallback);      
            }
        }
    };

    transformNext();

};


const processActiveImages = (() => {

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const suffixes = letters.concat(
            letters.map(a => a + a),
            letters.map(a => a + a + a),
            letters.map(a => a + a + a + a)
    );

    const renameDupes = async (fileNames, directory) => {

        const names = fileNames.map(next => [path.parse(next).name, path.parse(next).ext]);
        const unique = {};
        const dupes = [];

        for (const [name, ext] of names) {
            if (!unique[name]) {
                unique[name] = true;
            } else {
                dupes.push([name, ext]);
            }
        }

        if (dupes.length) {

            for (const [dupe, ext] of dupes) {

                for (const suffix of suffixes) {
                    const replacement = dupe + '-' + suffix;

                    if (!unique[replacement]) {
                        unique[replacement] = true;

                        await fs.promises.rename(
                            path.join(directory, dupe + ext), 
                            path.join(directory, replacement + ext)
                        );

                        break;
                    }
                }
            }

        }
    };

    const clearDirectory = async pathName => {
        const files = await fs.promises.readdir(pathName);

        for (const file of files) {
            await fs.promises.unlink(path.join(pathName, file));
        }

        return true;
    };

    const surveyAlbum = async (albumPath, successCallback, finalCallback) => {

        const topItems = await fs.promises.readdir(albumPath);
        const originalPath = path.join(albumPath, DEFAULT_IMAGE_DIRECTORY);

        if (!topItems.includes(DEFAULT_IMAGE_DIRECTORY)) {
            console.error('No directory found: ' + DEFAULT_IMAGE_DIRECTORY);
            return;
        }

        const originals = await fs.promises.readdir(originalPath);
        if (!originals.length) {
            console.error('No images found: ' + originalPath);
            return;
        }

        await renameDupes(originals, originalPath);

        for (const size of Object.values(TRANSFORM_SIZES)) {
            const sizePath = path.join(albumPath, size);
            if (!topItems.includes(size)) {
                fs.mkdirSync(sizePath);
            } else {
                await clearDirectory(sizePath);
            }
        }

        if (successCallback) { 
            successCallback(albumPath, finalCallback);
        }
    };



    const buildAlbumConversionSuccess = (allAlbums, successCallback) => {  

        /*
        const finished = [];

        const jsonSuccess = (albumPath) => {
            finished.push(albumPath);
            if (finished.length >= allAlbums.length) {
                console.log(' ');
                // hydrateNavJSON();
                if (successCallback) { successCallback(); }
            }
        };
        */

        return albumPath => {
            console.log(' ');
            console.log('---- ' + albumPath + ' --- Collect all metadata in a json file ----');
            hydrateJSON(albumPath, successCallback);
        };

    };

    return (albumArgument, successCallback, skipNameInput) => async () => {

        logIntro();

        const albumName = skipNameInput 
            ? albumArgument
            : await getDirectoryName(albumArgument);

        const workingPath = GALLERY_MAIN_PATH;
        const gallery = await fs.promises.readdir(workingPath);

        const albumPaths = [];
        for (const item of gallery.filter(notAppDir)) {
            if (albumName && item !== albumName) {
                continue;
            }
            const albumPath = path.join(workingPath, item);
            const stat = await fs.promises.stat(albumPath);
            if (stat.isDirectory()) {
                albumPaths.push(albumPath);
            }
        }

        if (!albumPaths.length) {
            console.log(' ');
            if (albumName) {
                console.log('Album [' + albumName + '] not found in /gallery-active');
            } else {
                console.log('No albums to process in /gallery-active');    
            }
            console.log(' ');
            if (successCallback) { successCallback(); }
            return;
        }

        const surveyNext = albumPath => {
            surveyAlbum(albumPath, albumTransform, conversionSuccess);
        };

        const proceed = () => {
            if (albumPaths.length) {
                const albumPath = albumPaths.shift();
                surveyNext(albumPath);
            } else if (successCallback) { 
                successCallback(); 
            }
        };

        const conversionSuccess = buildAlbumConversionSuccess(albumPaths, proceed);

        proceed();

    };

})();

module.exports = processActiveImages;