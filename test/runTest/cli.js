/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

const puppeteer = require('puppeteer');
const slugify = require('slugify');
const fse = require('fs-extra');
const fs = require('fs');
const path = require('path');
const program = require('commander');
const compareScreenshot = require('./compareScreenshot');
const {testNameFromFile, fileNameFromTest, getVersionDir, buildRuntimeCode, waitTime} = require('./util');
const {origin} = require('./config');
const Timeline = require('./Timeline');

// Handling input arguments.
program
    .option('-t, --tests <tests>', 'Tests names list')
    .option('--no-headless', 'Not headless')
    .option('-s, --speed <speed>', 'Playback speed')
    .option('--expected <expected>', 'Expected version')
    .option('--actual <actual>', 'Actual version');

program.parse(process.argv);

program.speed = +program.speed || 1;
program.actual = program.actual || 'local';
program.expected = program.expected || '4.2.1';

if (!program.tests) {
    throw new Error('Tests are required');
}

function getScreenshotDir() {
    return 'tmp/__screenshot__';
}

function sortScreenshots(list) {
    return list.sort((a, b) => {
        return a.screenshotName.localeCompare(b.screenshotName);
    });
}

function getClientRelativePath(absPath) {
    return path.join('../', path.relative(__dirname, absPath));
}

function replaceEChartsVersion(interceptedRequest, version) {
    // TODO Extensions and maps
    if (interceptedRequest.url().endsWith('dist/echarts.js')) {
        interceptedRequest.continue({
            url: `${origin}/test/runTest/${getVersionDir(version)}/echarts.js`
        });
    }
    else {
        interceptedRequest.continue();
    }
}

async function takeScreenshot(page, fullPage, fileUrl, desc, version, minor) {
    let screenshotName = testNameFromFile(fileUrl);
    if (desc) {
        screenshotName += '-' + slugify(desc, { replacement: '-', lower: true });
    }
    if (minor) {
        screenshotName += '-' + minor;
    }
    let screenshotPrefix = version ? 'expected' : 'actual';
    fse.ensureDirSync(path.join(__dirname, getScreenshotDir()));
    let screenshotPath = path.join(__dirname, `${getScreenshotDir()}/${screenshotName}-${screenshotPrefix}.png`);
    await page.screenshot({
        path: screenshotPath,
        fullPage
    });

    return {screenshotName, screenshotPath};
}

async function runActions(page, testOpt, version, screenshots) {
    let timeline = new Timeline(page);
    let actions;
    try {
        let actContent = fs.readFileSync(path.join(__dirname, 'actions', testOpt.name + '.json'));
        actions = JSON.parse(actContent);
    }
    catch (e) {
        // Can't find actions
        return;
    }

    let playbackSpeed = +program.speed;

    for (let action of actions) {
        await page.evaluate((x, y) => {
            window.scrollTo(x, y);
        }, action.scrollX, action.scrollY);

        let count = 0;
        async function _innerTakeScreenshot() {
            const desc = action.desc || action.name;
            const {screenshotName, screenshotPath} = await takeScreenshot(page, false, testOpt.fileUrl, desc, version, count++);
            screenshots.push({screenshotName, desc, screenshotPath});
        }
        await timeline.runAction(action, _innerTakeScreenshot,  playbackSpeed);

        if (count === 0) {
            await waitTime(200);
            await _innerTakeScreenshot();
        }

        // const desc = action.desc || action.name;
        // const {screenshotName, screenshotPath} = await takeScreenshot(page, false, testOpt.fileUrl, desc, version);
        // screenshots.push({screenshotName, desc, screenshotPath});
    }
    timeline.stop();
}

async function runTestPage(browser, testOpt, version, runtimeCode) {
    const fileUrl = testOpt.fileUrl;
    const screenshots = [];
    const logs = [];
    const errors = [];

    const page = await browser.newPage();
    page.setRequestInterception(true);
    page.on('request', replaceEChartsVersion);

    await page.evaluateOnNewDocument(runtimeCode);

    page.on('console', msg => {
        logs.push(msg.text());
    });
    page.on('pageerror', error => {
        errors.push(error.toString());
    });
    page.on('dialog', async dialog => {
        await dialog.dismiss();
    });

    try {
        await page.setViewport({width: 800, height: 600});
        await page.goto(`${origin}/test/${fileUrl}`, {
            waitUntil: 'networkidle2',
            timeout: 10000
        });

        await waitTime(200);  // Wait for animation or something else. Pending
        // Final shot.
        await page.mouse.move(0, 0);
        let desc = 'Full Shot';
        const {screenshotName, screenshotPath} = await takeScreenshot(page, true, fileUrl, desc, version);
        screenshots.push({screenshotName, desc, screenshotPath});

        await runActions(page, testOpt, version, screenshots);
    }
    catch(e) {
        console.error(e);
    }

    await page.close();

    return {
        logs,
        errors,
        screenshots: screenshots
    };
}

async function writePNG(diffPNG, diffPath) {
    return new Promise(resolve => {
        let writer = fs.createWriteStream(diffPath);
        diffPNG.pack().pipe(writer);
        writer.on('finish', () => {resolve();});
    });
};

async function runTest(browser, testOpt, runtimeCode, expectedVersion, actualVersion) {
    testOpt.status === 'running';
    const expectedResult = await runTestPage(browser, testOpt, expectedVersion, runtimeCode);
    const actualResult = await runTestPage(browser, testOpt, actualVersion, runtimeCode);

    // sortScreenshots(expectedResult.screenshots);
    // sortScreenshots(actualResult.screenshots);

    const screenshots = [];
    let idx = 0;
    for (let shot of expectedResult.screenshots) {
        let expected = shot;
        let actual = actualResult.screenshots[idx++];
        let {diffRatio, diffPNG} = await compareScreenshot(
            expected.screenshotPath,
            actual.screenshotPath
        );

        let diffPath = `${path.resolve(__dirname, getScreenshotDir())}/${shot.screenshotName}-diff.png`;
        await writePNG(diffPNG, diffPath);

        screenshots.push({
            actual: getClientRelativePath(actual.screenshotPath),
            expected: getClientRelativePath(expected.screenshotPath),
            diff: getClientRelativePath(diffPath),
            name: actual.screenshotName,
            desc: actual.desc,
            diffRatio
        });
    }

    testOpt.results = screenshots;
    testOpt.status = 'finished';
    testOpt.actualLogs = actualResult.logs;
    testOpt.expectedLogs = expectedResult.logs;
    testOpt.actualErrors = actualResult.errors;
    testOpt.expectedErrors = expectedResult.errors;
    testOpt.actualVersion = actualVersion;
    testOpt.expectedVersion = expectedVersion;
    testOpt.lastRun = Date.now();
}

async function runTests(pendingTests) {
    const browser = await puppeteer.launch({
        headless: program.headless,
        args: [`--window-size=830,750`] // new option
    });
    // TODO Not hardcoded.
    // let runtimeCode = fs.readFileSync(path.join(__dirname, 'tmp/testRuntime.js'), 'utf-8');
    let runtimeCode = await buildRuntimeCode();
    runtimeCode = `window.__TEST_PLAYBACK_SPEED__ = ${program.speed || 1};\n${runtimeCode}`;

    try {
        for (let testOpt of pendingTests) {
            console.log('Running Test', testOpt.name);
            try {
                await runTest(browser, testOpt, runtimeCode, program.expected, program.actual);
            }
            catch (e) {
                // Restore status
                testOpt.status = 'unsettled';
                console.log(e);
            }

            process.send(testOpt);
        }
    }
    catch(e) {
        console.log(e);
    }

    await browser.close();
}

runTests(program.tests.split(',').map(testName => {
    return {
        fileUrl: fileNameFromTest(testName),
        name: testName,
        results: [],
        status: 'unsettled'
    };
}));