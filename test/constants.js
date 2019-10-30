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

const BASE_ENDPOINT = '/mgmt/shared/cloud-failover';

const constants = require('../src/nodejs/constants.js');

/**
 * Constants used across two or more files
 *
 * @module
 */
module.exports = {
    restWorker: {
        loadState: (first, cb) => { cb(null); },
        saveState: (first, state, cb) => { cb(null); }
    },
    invalidRestWorker: {
        loadState: (first, cb) => { cb(true); },
        saveState: (first, state, cb) => { cb(null); }
    },
    declarations: {
        basic: {
            class: 'Cloud_Failover',
            environment: 'azure'
        }
    },
    REQUEST: {
        PORT: 443,
        PROTOCOL: 'https'
    },
    BASE_ENDPOINT,
    DECLARE_ENDPOINT: `${BASE_ENDPOINT}/declare`,
    INFO_ENDPOINT: `${BASE_ENDPOINT}/info`,
    TRIGGER_ENDPOINT: `${BASE_ENDPOINT}/trigger`,
    RESET_ENDPOINT: `${BASE_ENDPOINT}/reset`,
    PKG_NAME: 'f5-cloud-failover',
    DEPLOYMENT_FILE_VAR: 'CF_DEPLOYMENT_FILE',
    DEPLOYMENT_FILE: 'deployment_info.json',
    FAILOVER_STATES: constants.FAILOVER_STATES,
    RETRIES: {
        LONG: 500,
        MEDIUM: 100,
        SHORT: 10
    },
    TRIGGER_COMMENT: '# Autogenerated by F5 Failover Extension - Triggers failover',
    TRIGGER_COMMAND: 'curl -u admin:admin -d {} -X POST http://localhost:8100/mgmt/shared/cloud-failover/trigger',
    LEGACY_TRIGGER_COMMENT: '# Disabled by F5 Failover Extension',
    LEGACY_TRIGGER_COMMAND: '/usr/bin/f5-rest-node /config/cloud/azure/node_modules/@f5devcentral/f5-cloud-libs-azure/scripts/failoverProvider.js',
    STATE_FILE_RESET_MESSAGE: 'Failover state file was reset'
};
