/**
 * Copyright 2018 F5 Networks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const VERSION = '1.0.0';

/**
 * Constants used across two or more files
 *
 * @module
 */
module.exports = {
    VERSION,
    BASE_URL: 'https://localhost/mgmt/shared/cloud-failover',
    CONTROLS_CLASS_NAME: 'Controls',
    CLOUD_PROVIDERS: {
        AWS: 'aws',
        AZURE: 'azure',
        GCP: 'gcp'
    },
    CONTROLS_PROPERTY_NAME: 'controls',
    ENDPOINTS: {
        CONFIG: 'declare',
        FAILOVER: 'failover',
        TASK: 'task'
    },
    FAILOVER_CLASS_NAME: 'Failover',
    INITIALIZE_CLASS_NAME: 'Initialize',
    LOCAL_HOST: 'localhost',
    MASK_REGEX: new RegExp('pass(word|phrase)', 'i'),
    PATHS: {
        tgactive: '/config/failover/tgactive',
        tgrefresh: '/config/failover/tgrefresh'
    },
    STATUS: {
        STATUS_OK: 'OK',
        STATUS_ERROR: 'ERROR',
        STATUS_ROLLING_BACK: 'ROLLING_BACK',
        STATUS_RUNNING: 'RUNNING'
    },
    NAMELESS_CLASSES: [
    ],
    STORAGE_FOLDER_NAME: 'f5cloudfailover',
    STATE_FILE_NAME: 'f5cloudfailoverstate.json',
    FAILOVER_STATES: {
        PASS: 'SUCCEEDED',
        FAIL: 'FAILED',
        RUNNING: 'RUNNING'
    },
    GCP_LABEL_NAME: 'f5_cloud_failover_labels'
};
