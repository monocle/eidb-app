import App from 'appkit/app';

// personal version 8/20/13

(function(global, RSVP) {
  // In the following line, you should include the prefixes of implementations you want to test.
  var indexedDB = global.indexedDB || global.mozIndexedDB || global.webkitIndexedDB || global.msIndexedDB;
  // DON'T use "var indexedDB = ..." if you're not in a function.
  // Moreover, you may need references to some global.IDB* objects:
  global.IDBTransaction = global.IDBTransaction || global.webkitIDBTransaction || global.msIDBTransaction;
  var IDBKeyRange = global.IDBKeyRange = global.IDBKeyRange || global.webkitIDBKeyRange || global.msIDBKeyRange;
  // (Mozilla has never prefixed these objects, so we don't need global.mozIDB*)

  if (!global.indexedDB) {
      global.alert("Your browser doesn't support a stable version of IndexedDB. Such and such feature will not be available.");
  }

  var Promise = RSVP.Promise;

  var EIDB = global.EIDB = {
    open: function(name, version, upgradeCallback) {
      version = version || 1;

      return new Promise(function(resolve, reject) {
        var req = indexedDB.open(name, version);
        req.onsuccess = function(event) {
          resolve(new Database(req.result));
        };
        req.onerror = function(event) {
          reject(event);
        };
        req.onupgradeneeded = function(event) {
          // console.log("onupgradeneeded", event);
          if (upgradeCallback) { upgradeCallback(new Database(req.result)); }
        };
      });
    },

    _open: function(name, version, upgradeCallback) {
      return new Promise(function(resolve, reject) {
        var req = version ? indexedDB.open(name, version) : indexedDB.open(name);

        req.onsuccess = function(event) {
          resolve(new Database(req.result));
        };
        req.onerror = function(event) {
          reject(event);
        };
        req.onupgradeneeded = function(event) {
          if (upgradeCallback) { upgradeCallback({db: new Database(req.result), request: req}); } // different API than .open!
        };
      });
    },

    find: function(dbName, objectStore, query) {
      return new Promise(function(resolve, reject) {
        var queryKeys, queryVals, indexName, index, getResults,
            keyRange, res, version;

        queryKeys = Object.keys(query).sort();
        queryVals = queryKeys.map(function(key) {return query[key];});
        indexName = queryKeys.join('_');

        if (queryVals.length === 1) {
          queryVals = queryVals[0];
        }

        getResults = function(db) {
          keyRange = IDBKeyRange.only(queryVals);
          index = db.objectStore(objectStore).index(indexName);
          db.close();
          resolve(index.getAll(keyRange));
        };

        EIDB._open(dbName).then(function(db) {
          if (db.hasIndex(objectStore, indexName)) {
            getResults(db);
          } else {
            version = db.version + 1;
            db.close();

            EIDB._open(dbName, version, function(obj) {
              var db = obj.db,
                  tx = obj.request.transaction,
                  store = tx.objectStore(objectStore);

              if (queryKeys.length === 1) {
                queryKeys = queryKeys[0];
              }

              store.createIndex(indexName, queryKeys, {unique: false});
            }).then(function(db) {
              getResults(db);
            });
          }
        });
      });
    },

    "delete": function(name) {
      return new Promise(function(resolve, reject) {
        var req = indexedDB.deleteDatabase(name);
        req.onsuccess = function(event) {
          resolve(event);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    }
  };

  var Database = EIDB.Database = function(idbDatabase) {
    this._idbDatabase = idbDatabase;
    this.version = idbDatabase.version;
  };

  Database.prototype = {
    _idbDatabase: null,
    version: null,

    close: function() {
      return this._idbDatabase.close();
    },

    createObjectStore: function(name, options) {
      return new ObjectStore(this._idbDatabase.createObjectStore(name, options));
    },

    transaction: function(objectStores, mode) {
      var tx;

      if (mode !== undefined) {
        tx = this._idbDatabase.transaction(objectStores, mode);
      } else {
        tx = this._idbDatabase.transaction(objectStores);
      }

      return new Transaction(tx);
    },

    _transactionsMap: null,

    transactionFor: function(objectStore) {
      var self = this;
      if (!this._transactionsMap) { this._transactionsMap = {}; }

      // Clear transaction references at the end of the browser event loop
      // TODO: Is this sane?
      setTimeout(function() {
        self._transactionsMap = {};
      }, 0);

      return this._transactionsMap[objectStore] = this._transactionsMap[objectStore] || this.transaction([objectStore], "readwrite");
    },

    add: function(objectStore, id, obj) {
      var tx = this.transactionFor(objectStore),
          store = tx.objectStore(objectStore),
          key = store.keyPath;

      obj[key] = id;
      return store.add(obj).then(function(event) {
        return obj;
      });
    },

    get: function(objectStore, id) {
      var tx = this.transactionFor(objectStore),
          store = tx.objectStore(objectStore);
      return store.get(id);
    },

    put: function(objectStore, id, obj) {
      var tx = this.transactionFor(objectStore),
          store = tx.objectStore(objectStore),
          key = store.keyPath;

      obj[key] = id;
      return store.put(obj);
    },

    "delete": function(objectStore, id) {
      var tx = this.transactionFor(objectStore),
          store = tx.objectStore(objectStore);
      return store.delete(id);
    },

    objectStore: function(objectStore) {
      var tx = this.transactionFor(objectStore);
      return tx.objectStore(objectStore);
    },

    hasIndex: function(objectStore, indexName) {
      var store = this.objectStore(objectStore);
      return store.indexNames.contains(indexName);
    }
  };

  var ObjectStore = EIDB.ObjectStore = function(idbObjectStore) {
    this._idbObjectStore = idbObjectStore;
    this.keyPath = idbObjectStore.keyPath;
    this.indexNames = idbObjectStore.indexNames;
  };

  ObjectStore.prototype = {
    _idbObjectStore: null,
    keyPath: null,

    add: function(obj) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = self._idbObjectStore.add(obj);

        req.onsuccess = function(event) {
          resolve(event);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    get: function(key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = self._idbObjectStore.get(key);

        req.onsuccess = function(event) {
          resolve(event.target.result);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    put: function(obj, key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = key ? self._idbObjectStore.put(obj, key) : self._idbObjectStore.put(obj);

        req.onsuccess = function(event) {
          resolve(obj); // NOTE: event.target.result seems to be the ID, not the object
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    "delete": function(key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = self._idbObjectStore.delete(key);

        req.onsuccess = function(event) {
          resolve(event);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    indexNames: null,

    index: function(name) {
      return new EIDB.Index(this._idbObjectStore.index(name));
    },

    createIndex: function(name, keyPath, params) {
      var store = this._idbObjectStore,
          index = store.createIndex(name, keyPath, params);

      this.indexNames = store.indexNames;
      return new EIDB.Index(index);
    },

    deleteIndex: function(name) {
      var store = this._idbObjectStore,
          res = store.deleteIndex(name);

      this.indexNames = store.indexNames;
      return res;
    }
  };

  // transactions have onerror, onabort, and oncomplete events
  var Transaction = EIDB.Transaction = function(idbTransaction) {
    this._idbTransaction = idbTransaction;
  };

  Transaction.prototype = {
    _idbTransaction: null,

    objectStore: function(name) {
      return new ObjectStore(this._idbTransaction.objectStore(name));
    }
  };

  var Request = EIDB.Request = function(idbRequest) {
    this._idbRequest = idbRequest;
  };

  RSVP.EventTarget.mixin(Request.prototype);

  Request.prototype = {
    _idbRequest: null,
  };

  var Index = EIDB.Index = function(idbIndex) {
    this._idbIndex = idbIndex;
    this.name = idbIndex.name;
    this.objectStore = idbIndex.objectStore;
    this.keyPath = idbIndex.keyPath;
    this.multiEntry = idbIndex.multiEntry;
    this.unique = idbIndex.unique;
  };

  Index.prototype = {
    _idbIndex: null,
    name: null,
    objectStore: null,
    keyPath: null,
    multiEntry: null,
    unique: null,

    openCursor: function(range, direction, onsuccess) {
      var self = this;
      range = range || null;
      direction = direction || 'next';

      return new Promise(function(resolve, reject) {
        var req = self._idbIndex.openCursor(range, direction);

        req.onsuccess = function(event) {
          onsuccess(event.target.result, resolve);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    openKeyCursor: function(range, direction, onsuccess) {
      var self = this;
      range = range || null;
      direction = direction || 'next';

      return new Promise(function(resolve, reject) {
        var req = self._idbIndex.openKeyCursor(range, direction);

        req.onsuccess = function(event) {
          onsuccess(event.target.result, resolve);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    get: function(key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = self._idbIndex.get(key);

        req.onsuccess = function(event) {
          resolve(event.target.result);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    getKey: function(key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = self._idbIndex.getKey(key);

        req.onsuccess = function(event) {
          resolve(event.target.result);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    count: function(key) {
      var self = this;

      return new Promise(function(resolve, reject) {
        var req = key ? self._idbIndex.count(key) : self._idbIndex.count();

        req.onsuccess = function(event) {
          resolve(event.target.result);
        };
        req.onerror = function(event) {
          reject(event);
        };
      });
    },

    getAll: function(range, direction) {
      var res = [];

      return this.openCursor(range, direction, function(cursor, resolve) {
        if (cursor) {
          res.push(cursor.value);
          cursor.continue();
        } else {
          resolve(res);
        }
      });
    }
  };

})(this, Ember.RSVP);

export default window.EIDB;