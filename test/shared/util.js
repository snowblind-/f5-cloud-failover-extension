/*
 * Copyright 2019. F5 Networks, Inc. See End User License Agreement ("EULA") for
 * license terms. Notwithstanding anything to the contrary in the EULA, Licensee
 * may copy and modify this software product for its internal business purposes.
 * Further, Licensee may upload, publish and distribute the modified version of
 * the software product on devcentral.f5.com.
 */

'use strict';

const fs = require('fs');
const request = require('request');
const icrdk = require('icrdk'); // eslint-disable-line import/no-extraneous-dependencies

const constants = require('../constants.js');

module.exports = {

    /**
     * Stringify a message
     *
     * @param {Object|String} msg - message to stringify
     *
     * @returns {Object} Stringified message
     */
    stringify(msg) {
        if (typeof msg === 'object') {
            try {
                msg = JSON.stringify(msg);
            } catch (e) {
                // just leave original message intact
            }
        }
        return msg;
    },

    /**
     * Deep copy
     *
     * @param {Object} obj - object to copy
     *
     * @returns {Object} deep copy of source object
     */
    deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Get package details
     *
     * @returns {Object} { name: 'foo.rpm', path: '/tmp/foo.rpm' }
     */
    getPackageDetails() {
        const dir = `${__dirname}/../../dist/new_build`;
        const distFiles = fs.readdirSync(dir);
        const packageFiles = distFiles.filter(f => f.endsWith('.rpm'));

        // get latest rpm file (by timestamp since epoch)
        // note: this might not work if the artifact resets the timestamps
        const latest = { file: null, time: 0 };
        packageFiles.forEach((f) => {
            const fStats = fs.lstatSync(`${dir}/${f}`);
            if (fStats.birthtimeMs >= latest.time) {
                latest.file = f;
                latest.time = fStats.birthtimeMs;
            }
        });
        const packageFile = latest.file;

        return { name: packageFile, path: dir };
    },

    /**
     * Perform HTTP request
     *
     * @param {String}  host               - HTTP host
     * @param {String}  uri                - HTTP uri
     * @param {Object}  options            - function options
     * @param {Integer} [options.port]     - HTTP port, default is 443
     * @param {String}  [options.protocol] - HTTP protocol, default is https
     * @param {String}  [options.method]   - HTTP method, default is GET
     * @param {String}  [options.body]     - HTTP body
     * @param {Object}  [options.headers]  - HTTP headers
     *
     * @returns {Object} Returns promise resolved with response
     */
    makeRequest(host, uri, options) {
        options = options || {};
        const port = options.port === undefined ? constants.REQUEST.PORT : options.port;
        const protocol = options.protocol === undefined ? constants.REQUEST.PROTOCOL : options.protocol;

        host = host.endsWith('/') ? host.slice(0, host.length - 1) : host;
        uri = uri || '';
        uri = uri.startsWith('/') ? uri : `/${uri}`;

        const fullUri = `${protocol}://${host}:${port}${uri}`;
        const requestOptions = {
            uri: fullUri,
            method: options.method || 'GET',
            body: options.body ? this.stringify(options.body) : undefined,
            headers: options.headers || {},
            strictSSL: false
        };

        return new Promise((resolve, reject) => {
            request(requestOptions, (err, res, body) => {
                if (err) {
                    reject(new Error(`HTTP error for '${fullUri}' : ${err}`));
                } else if (res.statusCode >= 200 && res.statusCode <= 299) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    const msg = `Bad status code: ${res.statusCode} ${res.statusMessage} ${res.body} for '${fullUri}'`;
                    err = new Error(msg);
                    err.statusCode = res.statusCode;
                    err.statusMessage = res.statusMessage;
                    reject(err);
                }
            });
        });
    },

    /**
     * Get auth token
     *
     * @param {String} host     - host
     * @param {String} port     - port
     * @param {String} username - username
     * @param {String} password - password
     *
     * @returns {Promise} Returns promise resolved with auth token: { token: 'token' }
     */
    getAuthToken(host, port, username, password) {
        const uri = '/mgmt/shared/authn/login';
        const body = this.stringify({
            username,
            password,
            loginProviderName: 'tmos'
        });
        const postOptions = {
            port,
            method: 'POST',
            body
        };

        return this.makeRequest(host, uri, postOptions)
            .then(data => ({ token: data.token.token }))
            .catch((err) => {
                const msg = `getAuthToken: ${err}`;
                throw new Error(msg);
            });
    },

    /**
     * Query installed ILX packages
     *
     * @param {String} host      - host
     * @param {String} port      - port
     * @param {String} authToken - auth token
     *
     * @returns {Promise} Returns promise resolved upon completion
     */
    queryPackages(host, port, authToken) {
        const opts = {
            HOST: host,
            PORT: port,
            AUTH_TOKEN: authToken,
            // below should not be required, there is a bug in icrdk
            // https://github.com/f5devcentral/f5-icontrollx-dev-kit/blob/master/lib/util.js#L322
            headers: {
                'x-f5-auth-token': authToken
            }
        };

        return new Promise((resolve, reject) => {
            icrdk.queryInstalledPackages(opts, (err, results) => {
                if (err) {
                    reject(err);
                }
                resolve(results);
            });
        });
    },

    /**
     * Install ILX package
     *
     * @param {String} host      - host
     * @param {String} port      - port
     * @param {String} authToken - auth token
     * @param {String} file      - local file (RPM) to install
     *
     * @returns {Promise} Returns promise resolved upon completion
     */
    installPackage(host, port, authToken, file) {
        const opts = {
            HOST: host,
            PORT: port,
            AUTH_TOKEN: authToken
        };

        return new Promise((resolve, reject) => {
            icrdk.deployToBigIp(opts, file, (err) => {
                if (err) {
                    if (/already installed/.test(err)) {
                        resolve();
                    } else {
                        reject(err);
                    }
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Uninstall ILX package
     *
     * @param {String} host      - host
     * @param {String} port      - port
     * @param {String} authToken - auth token
     * @param {String} pkg       - package to remove from device
     *
     * @returns {Promise} Returns promise resolved upon completion
     */
    uninstallPackage(host, port, authToken, pkg) {
        const opts = {
            HOST: host,
            PORT: port,
            AUTH_TOKEN: authToken
        };

        return new Promise((resolve, reject) => {
            icrdk.uninstallPackage(opts, pkg, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
};
