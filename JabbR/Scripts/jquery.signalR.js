﻿/// <reference path="jquery-1.6.2.js" />
(function ($, window) {
    /// <param name="$" type="jQuery" />
    "use strict";

    if (typeof ($) !== "function") {
        // no jQuery!
        throw "SignalR: jQuery not found. Please ensure jQuery is referenced before the SignalR.js file.";
    }

    if (!window.JSON) {
        // no JSON!
        throw "SignalR: No JSON parser found. Please ensure json2.js is referenced before the SignalR.js file if you need to support clients without native JSON parsing support, e.g. IE<8.";
    }

    var signalR,
        _connection,
        log = function (msg) {
            var m;
            if (typeof (window.console) === "undefined") {
                return;
            }
            m = "[" + new Date().toTimeString() + "] SignalR: " + msg;
            if (window.console.debug) {
                window.console.debug(m);
            } else if (window.console.log) {
                window.console.log(m);
            }
        };

    signalR = function (url, qs) {
        /// <summary>Creates a new SignalR connection for the given url</summary>
        /// <param name="url" type="String">The URL of the long polling endpoint</param>
        /// <param name="qs" type="Object">
        ///     [Optional] Custom querystring parameters to add to the connection URL.
        ///     If an object, every non-function member will be added to the querystring.
        ///     If a string, it's added to the QS as specified.
        /// </param>
        /// <returns type="signalR" />

        return new signalR.fn.init(url, qs);
    };

    signalR.fn = signalR.prototype = {
        init: function (url, qs) {
            this.url = url;
            this.qs = qs;
        },

        reconnectDelay: 2000,

        start: function (options, callback) {
            /// <summary>Starts the connection</summary>
            /// <param name="options" type="Object">Options map</param>
            /// <param name="callback" type="Function">A callback function to execute when the connection has started</param>
            var connection = this,
                config = {
                    transport: "auto"
                },
                initialize,
                promise = $.Deferred();

            if (connection.transport) {
                // Already started, just return
                promise.resolve(connection);
                return promise;
            }

            if ($.type(options) === "function") {
                // Support calling with single callback parameter
                callback = options;
            } else if ($.type(options) === "object") {
                $.extend(config, options);
                if ($.type(config.callback) === "function") {
                    callback = config.callback;
                }
            }

            $(connection).bind("onStart", function (e, data) {
                if ($.type(callback) === "function") {
                    callback.call(connection);
                }
                promise.resolve(connection);
            });

            initialize = function (transports, index) {
                index = index || 0;
                if (index >= transports.length) {
                    if (!connection.transport) {
                        // No transport initialized successfully
                        promise.reject("SignalR: No transport could be initialized successfully. Try specifying a different transport or none at all for auto initialization.");
                    }
                    return;
                }

                var transportName = transports[index],
                    transport = $.type(transportName) === "object" ? transportName : signalR.transports[transportName];

                transport.start(connection, function () {
                    connection.transport = transport;
                    $(connection).trigger("onStart");
                }, function () {
                    initialize(transports, index + 1);
                });
            };

            window.setTimeout(function () {
                $.ajax(connection.url + "/negotiate", {
                    global: false,
                    type: "POST",
                    data: {},
                    success: function (res) {
                        connection.appRelativeUrl = res.Url;
                        connection.id = res.ConnectionId;
                        connection.webSocketServerUrl = res.WebSocketServerUrl;

                        if (!res.ProtocolVersion || res.ProtocolVersion !== "1.0") {
                            throw "SignalR: Incompatible protocol version.";
                        }

                        $(connection).trigger("onStarting");

                        var transports = [],
                            supportedTransports = [];

                        $.each(signalR.transports, function (key) {
                            if (key === "webSockets" && !res.TryWebSockets) {
                                // Server said don't even try WebSockets, but keep processing the loop
                                return true;
                            }
                            supportedTransports.push(key);
                        });

                        if ($.isArray(config.transport)) {
                            // ordered list provided
                            $.each(config.transport, function () {
                                var transport = this;
                                if ($.type(transport) === "object" || ($.type(transport) === "string" && $.inArray("" + transport, supportedTransports) >= 0)) {
                                    transports.push($.type(transport) === "string" ? "" + transport : transport);
                                }
                            });
                        } else if ($.type(config.transport) === "object" ||
                                       $.inArray(config.transport, supportedTransports) >= 0) {
                            // specific transport provided, as object or a named transport, e.g. "longPolling"
                            transports.push(config.transport);
                        } else { // default "auto"
                            transports = supportedTransports;
                        }
                        initialize(transports);
                    }
                });
            }, 0);

            return promise;
        },

        starting: function (callback) {
            /// <summary>Adds a callback that will be invoked before the connection is started</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is starting</param>
            /// <returns type="signalR" />
            var connection = this,
                $connection = $(connection);

            $connection.bind("onStarting", function (e, data) {
                callback.call(connection);
                // Unbind immediately, we don't want to call this callback again
                $connection.unbind("onStarting");
            });

            return connection;
        },

        send: function (data) {
            /// <summary>Sends data over the connection</summary>
            /// <param name="data" type="String">The data to send over the connection</param>
            /// <returns type="signalR" />
            var connection = this;

            if (!connection.transport) {
                // Connection hasn't been started yet
                throw "SignalR: Connection must be started before data can be sent. Call .start() before .send()";
            }

            connection.transport.send(connection, data);

            return connection;
        },

        sending: function (callback) {
            /// <summary>Adds a callback that will be invoked before anything is sent over the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute before each time data is sent on the connection</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind("onSending", function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        received: function (callback) {
            /// <summary>Adds a callback that will be invoked after anything is received over the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute when any data is received on the connection</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind("onReceived", function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        error: function (callback) {
            /// <summary>Adds a callback that will be invoked after an error occurs with the connection</summary>
            /// <param name="callback" type="Function">A callback function to execute when an error occurs on the connection</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind("onError", function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        disconnect: function (callback) {
            /// <summary>Adds a callback that will be invoked when the client disconnects</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is broken</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind("onDisconnect", function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        reconnect: function (callback) {
            /// <summary>Adds a callback that will be invoked when the underlying transport reconnects</summary>
            /// <param name="callback" type="Function">A callback function to execute when the connection is restored</param>
            /// <returns type="signalR" />
            var connection = this;
            $(connection).bind("onReconnect", function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        stop: function () {
            /// <summary>Stops listening</summary>
            /// <returns type="signalR" />
            var connection = this;

            if (connection.transport) {
                connection.transport.stop(connection);
                connection.transport = null;
            }

            delete connection.messageId;
            delete connection.groups;

            return connection;
        },

        log: log
    };

    signalR.fn.init.prototype = signalR.fn;


    // Transports
    var transportLogic = {

        addQs: function (url, connection) {
            if (!connection.qs) {
                return url;
            }

            if (typeof (connection.qs) === "object") {
                return url + "&" + $.param(connection.qs);
            }

            if (typeof (connection.qs) === "string") {
                return url + "&" + connection.qs;
            }

            return url + "&" + escape(connection.qs.toString());
        },

        getUrl: function (connection, transport, reconnecting) {
            /// <summary>Gets the url for making a GET based connect request</summary>
            var url = connection.url,
                qs = "transport=" + transport + "&connectionId=" + window.escape(connection.id);

            if (connection.data) {
                qs += "&connectionData=" + window.escape(connection.data);
            }

            if (!reconnecting) {
                url = url + "/connect";
            } else {
                if (connection.messageId) {
                    qs += "&messageId=" + connection.messageId;
                }
                if (connection.groups) {
                    qs += "&groups=" + window.escape(JSON.stringify(connection.groups));
                }
            }
            url += "?" + qs;
            url = this.addQs(url, connection);
            return url;
        },

        ajaxSend: function (connection, data) {
            var url = connection.url + "/send" + "?transport=" + connection.transport.name + "&connectionId=" + window.escape(connection.id);
            url = this.addQs(url, connection);
            $.ajax(url, {
                global: false,
                type: "POST",
                dataType: "json",
                data: {
                    data: data
                },
                success: function (result) {
                    if (result) {
                        $(connection).trigger("onReceived", [result]);
                    }
                },
                error: function (errData, textStatus) {
                    if (textStatus === "abort") {
                        return;
                    }
                    $(connection).trigger("onError", [errData]);
                }
            });
        },

        processMessages: function (connection, data) {
            var $connection = $(connection);

            if (data) {
                if (data.Disconnect) {
                    log("disconnect command received from server");

                    // Disconnected by the server
                    connection.stop();

                    // Trigger the disconnect event
                    $connection.trigger("onDisconnect");
                    return;
                }

                if (data.Messages) {
                    $.each(data.Messages, function () {
                        try {
                            $connection.trigger("onReceived", [this]);
                        }
                        catch (e) {
                            log("Error raising received " + e);
                            $(connection).trigger("onError", [e]);
                        }
                    });
                }
                connection.messageId = data.MessageId;
                connection.groups = data.TransportData.Groups;
            }
        },

        foreverFrame: {
            count: 0,
            connections: {}
        }
    };

    signalR.transports = {

        webSockets: {
            name: "webSockets",

            send: function (connection, data) {
                connection.socket.send(data);
            },

            start: function (connection, onSuccess, onFailed) {
                var url,
                    opened = false,
                    protocol;

                if (window.MozWebSocket) {
                    window.WebSocket = window.MozWebSocket;
                }

                if (!window.WebSocket) {
                    onFailed();
                    return;
                }

                if (!connection.socket) {
                    if (connection.webSocketServerUrl) {
                        url = connection.webSocketServerUrl;
                    }
                    else {
                        // Determine the protocol
                        protocol = document.location.protocol === "https:" ? "wss://" : "ws://";

                        url = protocol + document.location.host + connection.appRelativeUrl;
                    }

                    // Build the url
                    $(connection).trigger("onSending");
                    if (connection.data) {
                        url += "?connectionData=" + connection.data + "&transport=webSockets&connectionId=" + connection.id;
                    } else {
                        url += "?transport=webSockets&connectionId=" + connection.id;
                    }

                    connection.socket = new window.WebSocket(url);
                    connection.socket.onopen = function () {
                        opened = true;
                        if (onSuccess) {
                            onSuccess();
                        }
                    };

                    connection.socket.onclose = function (event) {
                        if (!opened) {
                            if (onFailed) {
                                onFailed();
                            }
                        } else if (typeof event.wasClean != "undefined" && event.wasClean === false) {
                            // Ideally this would use the websocket.onerror handler (rather than checking wasClean in onclose) but
                            // I found in some circumstances Chrome won't call onerror. This implementation seems to work on all browsers.
                            $(connection).trigger("onError");
                            // TODO: Support reconnect attempt here, need to ensure last message id, groups, and connection data go up on reconnect
                        }
                        connection.socket = null;
                    };

                    connection.socket.onmessage = function (event) {
                        var data = window.JSON.parse(event.data),
                            $connection;
                        if (data) {
                            $connection = $(connection);

                            if (data.Messages) {
                                $.each(data.Messages, function () {
                                    try {
                                        $connection.trigger("onReceived", [this]);
                                    }
                                    catch (e) {
                                        log("Error raising received " + e);
                                    }
                                });
                            } else {
                                $connection.trigger("onReceived", [data]);
                            }
                        }
                    };
                }
            },

            stop: function (connection) {
                if (connection.socket !== null) {
                    connection.socket.close();
                    connection.socket = null;
                }
            }
        },

        serverSentEvents: {
            name: "serverSentEvents",

            timeOut: 3000,

            start: function (connection, onSuccess, onFailed) {
                var that = this,
                    opened = false,
                    $connection = $(connection),
                    reconnecting = !onSuccess,
                    url,
                    connectTimeOut;

                if (connection.eventSource) {
                    connection.stop();
                }

                if (!window.EventSource) {
                    if (onFailed) {
                        onFailed();
                    }
                    return;
                }

                $connection.trigger("onSending");

                url = transportLogic.getUrl(connection, this.name, reconnecting);

                try {
                    connection.eventSource = new window.EventSource(url);
                }
                catch (e) {
                    log("EventSource failed trying to connect with error " + e.Message);
                    if (onFailed) {
                        // The connection failed, call the failed callback
                        onFailed();
                    }
                    else {
                        $connection.trigger("onError", [e]);
                        if (reconnecting) {
                            // If we were reconnecting, rather than doing initial connect, then try reconnect again
                            log("EventSource reconnecting");
                            that.reconnect(connection);
                        }
                        else {
                            // Trigger the disconnect event
                            $connection.trigger("onDisconnect");
                        }
                    }
                    return;
                }

                // After connecting, if after the specified timeout there's no response stop the connection
                // and raise on failed
                connectTimeOut = window.setTimeout(function () {
                    if (opened === false) {
                        log("EventSource timed out trying to connect");

                        if (onFailed) {
                            onFailed();
                        }

                        if (reconnecting) {
                            // If we were reconnecting, rather than doing initial connect, then try reconnect again
                            log("EventSource reconnecting");
                            that.reconnect(connection);
                        } else {
                            that.stop(connection);
                        }
                    }
                },
                that.timeOut);

                connection.eventSource.addEventListener("open", function (e) {
                    log("EventSource connected");

                    if (connectTimeOut) {
                        window.clearTimeout(connectTimeOut);
                    }

                    if (opened === false) {
                        opened = true;

                        if (onSuccess) {
                            onSuccess();
                        }

                        if (reconnecting) {
                            $connection.trigger("onReconnect");
                        }
                    }
                }, false);

                connection.eventSource.addEventListener("message", function (e) {
                    // process messages
                    if (e.data === "initialized") {
                        return;
                    }
                    transportLogic.processMessages(connection, window.JSON.parse(e.data));
                }, false);

                connection.eventSource.addEventListener("error", function (e) {
                    if (!opened) {
                        if (onFailed) {
                            onFailed();
                        }
                        return;
                    }

                    log("EventSource readyState: " + connection.eventSource.readyState);

                    if (e.eventPhase === window.EventSource.CLOSED) {
                        // connection closed
                        if (connection.eventSource.readyState === window.EventSource.CONNECTING) {
                            // We don't use the EventSource's native reconnect function as it
                            // doesn't allow us to change the URL when reconnecting. We need
                            // to change the URL to not include the /connect suffix, and pass
                            // the last message id we received.
                            log("EventSource reconnecting due to the server connection ending");
                            that.reconnect(connection);
                        }
                        else {
                            // The EventSource has closed, either because its close() method was called,
                            // or the server sent down a "don't reconnect" frame.
                            log("EventSource closed");
                            that.stop(connection);
                        }
                    } else {
                        // connection error
                        log("EventSource error");
                        $connection.trigger("onError");

                        // Trigger the disconnect event
                        $connection.trigger("onDisconnect");
                    }
                }, false);
            },

            reconnect: function (connection) {
                var that = this;
                window.setTimeout(function () {
                    that.stop(connection);
                    that.start(connection);
                }, connection.reconnectDelay);
            },

            send: function (connection, data) {
                transportLogic.ajaxSend(connection, data);
            },

            stop: function (connection) {
                if (connection && connection.eventSource) {
                    connection.eventSource.close();
                    connection.eventSource = null;
                    delete connection.eventSource;
                }
            }
        },

        foreverFrame: {
            name: "foreverFrame",

            timeOut: 3000,

            start: function (connection, onSuccess, onFailed) {
                var that = this,
                    frameId = (transportLogic.foreverFrame.count += 1),
                    url,
                    connectTimeOut,
                    frame = $("<iframe data-signalr-connection-id='" + connection.id + "' style='position:absolute;width:0;height:0;visibility:hidden;'></iframe>");

                if (window.EventSource) {
                    // If the browser supports SSE, don't use Forever Frame
                    if (onFailed) {
                        onFailed();
                    }
                    return;
                }

                $(connection).trigger("onSending");

                // Build the url
                url = transportLogic.getUrl(connection, this.name);
                url += "&frameId=" + frameId;

                frame.prop("src", url);
                transportLogic.foreverFrame.connections[frameId] = connection;

                frame.bind("readystatechange", function () {
                    if ($.inArray(this.readyState, ["loaded", "complete"]) >= 0) {
                        log("Forever frame iframe readyState changed to " + this.readyState + ", reconnecting");
                        that.reconnect(connection);
                    }
                });

                connection.frame = frame[0];
                connection.frameId = frameId;

                if (onSuccess) {
                    connection.onSuccess = onSuccess;
                }

                $("body").append(frame);

                // After connecting, if after the specified timeout there's no response stop the connection
                // and raise on failed
                connectTimeOut = window.setTimeout(function () {
                    if (connection.onSuccess) {
                        that.stop(connection);

                        if (onFailed) {
                            onFailed();
                        }
                    }
                }, that.timeOut);
            },

            reconnect: function (connection) {
                var that = this;
                window.setTimeout(function () {
                    var frame = connection.frame,
                        src = transportLogic.getUrl(connection, that.name, true) + "&frameId=" + connection.frameId;
                    frame.src = src;
                }, connection.reconnectDelay);
            },

            send: function (connection, data) {
                transportLogic.ajaxSend(connection, data);
            },

            receive: transportLogic.processMessages,

            stop: function (connection) {
                if (connection.frame) {
                    if (connection.frame.stop) {
                        connection.frame.stop();
                    } else if (connection.frame.document && connection.frame.document.execCommand) {
                        connection.frame.document.execCommand("Stop");
                    }
                    $(connection.frame).remove();
                    delete transportLogic.foreverFrame.connections[connection.frameId];
                    connection.frame = null;
                    connection.frameId = null;
                    delete connection.frame;
                    delete connection.frameId;
                }
            },

            getConnection: function (id) {
                return transportLogic.foreverFrame.connections[id];
            },

            started: function (connection) {
                if (connection.onSuccess) {
                    connection.onSuccess();
                    connection.onSuccess = null;
                    delete connection.onSuccess;
                }
                else {
                    // If there's no onSuccess handler we assume this is a reconnect
                    $(connection).trigger("onReconnect");
                }
            }
        },

        longPolling: {
            name: "longPolling",

            start: function (connection, onSuccess, onFailed) {
                /// <summary>Starts the long polling connection</summary>
                /// <param name="connection" type="signalR">The SignalR connection to start</param>
                var that = this;
                if (connection.pollXhr) {
                    connection.stop();
                }

                connection.messageId = null;

                window.setTimeout(function () {
                    (function poll(instance) {
                        $(instance).trigger("onSending");

                        var messageId = instance.messageId,
                            connect = (messageId === null),
                            url = transportLogic.getUrl(instance, that.name, !connect);

                        if (!connect) {
                            window.setTimeout(function () {
                                $(instance).trigger("onReconnect");
                            }, 100);
                        }

                        instance.pollXhr = $.ajax(url, {
                            global: false,

                            type: "GET",

                            dataType: "json",

                            success: function (data) {
                                var delay = 0;
                                transportLogic.processMessages(instance, data);
                                if (data && $.type(data.TransportData.LongPollDelay) === "number") {
                                    delay = data.TransportData.LongPollDelay;
                                }
                                if (delay > 0) {
                                    window.setTimeout(function () {
                                        poll(instance);
                                    }, delay);
                                } else {
                                    poll(instance);
                                }
                            },

                            error: function (data, textStatus) {
                                if (textStatus === "abort") {
                                    return;
                                }

                                $(instance).trigger("onError", [data]);

                                window.setTimeout(function () {
                                    poll(instance);
                                }, connection.reconnectDelay);
                            }
                        });
                    } (connection));

                    // Now connected
                    // There's no good way know when the long poll has actually started so 
                    // we assume it only takes around 150ms (max) to start the connection
                    window.setTimeout(onSuccess, 150);

                }, 250); // Have to delay initial poll so Chrome doesn't show loader spinner in tab
            },

            send: function (connection, data) {
                transportLogic.ajaxSend(connection, data);
            },

            stop: function (connection) {
                /// <summary>Stops the long polling connection</summary>
                /// <param name="connection" type="signalR">The SignalR connection to stop</param>
                if (connection.pollXhr) {
                    connection.pollXhr.abort();
                    connection.pollXhr = null;
                    delete connection.pollXhr;
                }
            }
        }
    };

    signalR.noConflict = function () {
        /// <summary>Reinstates the original value of $.connection and returns the signalR object for manual assignment</summary>
        /// <returns type="signalR" />
        if ($.connection === signalR) {
            $.connection = _connection;
        }
        return signalR;
    };

    if ($.connection) {
        _connection = $.connection;
    }

    $.connection = $.signalR = signalR;

} (window.jQuery, window));