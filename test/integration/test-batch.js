'use strict';

const base = require('../base.js');
const { assert } = require('chai');
const Capabilities = require('../../lib/const/capabilities');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Conf = require('../conf');
const str = base.utf8Collation()
  ? "abcdefghijkflmn'opqrtuvwx🤘💪"
  : 'abcdefghijkflmn\'opqrtuvwxyz"';

describe('batch', function () {
  const fileName = path.join(os.tmpdir(), Math.random() + 'tempBatchFile.txt');
  const testSize = 16 * 1024 * 1024 + 80; // more than one packet
  let maxAllowedSize, bigBuf, timezoneParam;
  let supportBulk;
  const RUN_LONG_TEST = process.env.RUN_LONG_TEST == '1';
  this.timeout(30000);
  before(async function () {
    timezoneParam = 'America/New_York';
    supportBulk = (Conf.baseConfig.bulk === undefined ? true : Conf.baseConfig.bulk)
      ? (shareConn.info.serverCapabilities & Capabilities.MARIADB_CLIENT_STMT_BULK_OPERATIONS) > 0
      : false;
    const row = await shareConn.query('SELECT @@max_allowed_packet as t');
    maxAllowedSize = Number(row[0].t);
    if (testSize < maxAllowedSize) {
      bigBuf = Buffer.alloc(testSize);
      for (let i = 0; i < testSize; i++) {
        bigBuf[i] = 97 + (i % 10);
      }
    }
    const buf = Buffer.from(str);
    fs.writeFileSync(fileName, buf, 'utf8');
  });

  beforeEach(async function () {
    //just to ensure shared connection is not closed by server due to inactivity
    await shareConn.ping();
  });

  after(function () {
    fs.unlink(fileName, (err) => {
      if (err) console.log(err);
    });
  });

  const simpleBatch = async (useCompression, useBulk, timezone) => {
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      timezone: timezone
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);

    conn.query('DROP TABLE IF EXISTS simpleBatch');
    conn.query(
      'CREATE TABLE simpleBatch(id int, id2 boolean, id3 int, t varchar(128), d datetime, d2 datetime(6), g POINT, id4 int) CHARSET utf8mb4'
    );
    await shareConn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    const f = {};
    f.toSqlString = () => {
      return 'blabla';
    };
    let res = await conn.batch('INSERT INTO `simpleBatch` values (1, ?, 2, ?, ?, ?, ?, 3)', [
      [
        true,
        'Ʉjo"h\u000An😎🌶\\\\',
        new Date('2001-12-31 23:59:58+3'),
        new Date('2018-01-01 12:30:20.456789+3'),
        {
          type: 'Point',
          coordinates: [10, 10]
        }
      ],
      [
        true,
        f,
        new Date('2001-12-31 23:59:58+3'),
        new Date('2018-01-01 12:30:20.456789+3'),
        {
          type: 'Point',
          coordinates: [10, 10]
        }
      ],
      [
        false,
        { name: 'jack\u000Aमस्', val: 'tt' },
        null,
        new Date('2018-01-21 11:30:20.123456+3'),
        {
          type: 'Point',
          coordinates: [10, 20]
        }
      ],
      [
        0,
        null,
        new Date('2020-12-31 23:59:59+3'),
        new Date('2018-01-21 11:30:20.123456+3'),
        {
          type: 'Point',
          coordinates: [20, 20]
        }
      ]
    ]);
    assert.equal(res.affectedRows, 4);
    res = await conn.query('select * from `simpleBatch`');
    assert.deepEqual(res, [
      {
        id: 1,
        id2: 1,
        id3: 2,
        t: 'Ʉjo"h\u000An😎🌶\\\\',
        d: new Date('2001-12-31 23:59:58+3'),
        d2: new Date('2018-01-01 12:30:20.456789+3'),
        g: {
          type: 'Point',
          coordinates: [10, 10]
        },
        id4: 3
      },
      {
        id: 1,
        id2: 1,
        id3: 2,
        t: 'blabla',
        d: new Date('2001-12-31 23:59:58+3'),
        d2: new Date('2018-01-01 12:30:20.456789+3'),
        g: {
          type: 'Point',
          coordinates: [10, 10]
        },
        id4: 3
      },
      {
        id: 1,
        id2: 0,
        id3: 2,
        t: '{"name":"jack\\nमस्","val":"tt"}',
        d: null,
        d2: new Date('2018-01-21 11:30:20.123456+3'),
        g: {
          type: 'Point',
          coordinates: [10, 20]
        },
        id4: 3
      },
      {
        id: 1,
        id2: 0,
        id3: 2,
        t: null,
        d: new Date('2020-12-31 23:59:59+3'),
        d2: new Date('2018-01-21 11:30:20.123456+3'),
        g: {
          type: 'Point',
          coordinates: [20, 20]
        },
        id4: 3
      }
    ]);
    await conn.query('ROLLBACK');

    conn.query('DROP TABLE simpleBatch');
    clearTimeout(timeout);

    const rows = await conn.query({ sql: 'select 1', bigIntAsNumber: true });
    assert.deepEqual(rows, [{ 1: 1 }]);
    conn.end();
  };

  const simpleBatchWithOptions = async (useCompression, useBulk) => {
    const conn = await base.createConnection({ compress: useCompression, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);

    conn.query('DROP TABLE IF EXISTS simpleBatchWithOptions');
    conn.query('CREATE TABLE simpleBatchWithOptions(id int, d datetime)');
    await shareConn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    const f = {};
    f.toSqlString = () => {
      return 'blabla';
    };
    let res = await conn.batch(
      {
        sql: 'INSERT INTO `simpleBatchWithOptions` values (?, ?)',
        maxAllowedPacket: 1048576
      },
      [
        [1, new Date('2001-12-31 23:59:58')],
        [2, new Date('2001-12-31 23:59:58')]
      ]
    );
    assert.equal(res.affectedRows, 2);
    res = await conn.query('select * from `simpleBatchWithOptions`');
    assert.deepEqual(res, [
      {
        id: 1,
        d: new Date('2001-12-31 23:59:58')
      },
      {
        id: 2,
        d: new Date('2001-12-31 23:59:58')
      }
    ]);
    await conn.query('ROLLBACK');

    conn.query('DROP TABLE simpleBatchWithOptions');
    clearTimeout(timeout);
    conn.end();
  };

  const simpleBatchEncodingCP1251 = async (useCompression, useBulk, timezone) => {
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      collation: 'CP1251_GENERAL_CI'
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);

    conn.query('DROP TABLE IF EXISTS simpleBatchCP1251');
    conn.query('CREATE TABLE simpleBatchCP1251(t varchar(128), id int) CHARSET utf8mb4');
    await shareConn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    let res = await conn.batch('INSERT INTO `simpleBatchCP1251` values (?, ?)', [
      ['john', 2],
      ['©°', 3]
    ]);
    assert.equal(res.affectedRows, 2);
    res = await conn.query('select * from `simpleBatchCP1251`');
    assert.deepEqual(res, [
      { id: 2, t: 'john' },
      { id: 3, t: '©°' }
    ]);
    await conn.query('ROLLBACK');

    conn.query('DROP TABLE simpleBatchCP1251');
    clearTimeout(timeout);
    conn.end();
  };

  const simpleBatchErrorMsg = async (compression, useBulk) => {
    const conn = await base.createConnection({ trace: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);

    try {
      await conn.batch('INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)', [
        [1, 'john'],
        [2, 'jack']
      ]);
      throw new Error('must have thrown error !');
    } catch (err) {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes(" doesn't exist"));
      assert.isTrue(
        err.message.includes('sql: INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)')
      );
      assert.equal(err.errno, 1146);
      assert.equal(err.sqlState, '42S02');
      assert.equal(err.code, 'ER_NO_SUCH_TABLE');
      conn.end();
      clearTimeout(timeout);
    }
  };

  const noValueBatch = async (compression, useBulk) => {
    const conn = await base.createConnection({ trace: true, bulk: useBulk });
    await conn.query('DROP TABLE IF EXISTS noValueBatch');
    await conn.query('CREATE TABLE noValueBatch(id int not null primary key auto_increment)');
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 2000);
    await shareConn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    await conn.batch('INSERT INTO noValueBatch values ()', [[], []]);
    const res = await conn.query('SELECT COUNT(*) as nb FROM noValueBatch');
    assert.equal(res[0].nb, 2);
    conn.end();
    clearTimeout(timeout);
  };

  const simpleBatchErrorSplit = async (useCompression, useBulk, timezone) => {
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      timezone: timezone
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);

    await conn.query('DROP TABLE IF EXISTS simpleBatch');
    await conn.query(
      'CREATE TABLE simpleBatch(id int, id2 boolean, id3 int, t varchar(8), d datetime, d2 datetime(6), g POINT, id4 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');
    try {
      await conn.batch('INSERT INTO `simpleBatch` values (1, ?, 2, ?, ?, ?, ?, 3)', [
        [
          true,
          'john',
          new Date('2001-12-31 23:59:58'),
          new Date('2018-01-01 12:30:20.456789'),
          {
            type: 'Point',
            coordinates: [10, 10]
          }
        ],
        [
          false,
          '12345678901',
          null,
          new Date('2018-01-21 11:30:20.123456'),
          {
            type: 'Point',
            coordinates: [10, 20]
          }
        ],
        [
          0,
          null,
          new Date('2020-12-31 23:59:59'),
          new Date('2018-01-21 11:30:20.123456'),
          {
            type: 'Point',
            coordinates: [20, 20]
          }
        ]
      ]);
      if (
        (shareConn.info.isMariaDB() && shareConn.info.hasMinVersion(10, 2, 0)) ||
        (!shareConn.info.isMariaDB() && shareConn.info.hasMinVersion(5, 7, 0))
      ) {
        //field truncated must have thrown error
        throw new Error('must have throw error !');
      }
    } catch (err) {
      assert.isTrue(err.message.includes("Data too long for column 't' at row"), err.message);
    }
    conn.query('DROP TABLE simpleBatch');
    conn.end();
    clearTimeout(timeout);
  };

  const nonRewritableBatch = async (useCompression, useBulk) => {
    const conn = await base.createConnection({ compress: useCompression, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    try {
      let res = await conn.batch('SELECT ? as id, ? as t', [
        [1, 'john'],
        [2, 'jack']
      ]);
      if (useBulk && conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
        throw new Error('Must have thrown an exception');
      }
      assert.deepEqual(res, [
        [
          {
            id: 1,
            t: 'john'
          }
        ],
        [
          {
            id: 2,
            t: 'jack'
          }
        ]
      ]);
    } catch (err) {
      if (useBulk & conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
        assert.isTrue(
          err.message.includes(
            'This command is not supported in the prepared statement protocol yet'
          ),
          err.message
        );
      }
    }
    clearTimeout(timeout);
    conn.end();
  };

  const bigBatchWith16mMaxAllowedPacket = async (useCompression, useBulk) => {
    const conn = await base.createConnection({
      compress: useCompression,
      maxAllowedPacket: 16 * 1024 * 1024,
      bulk: useBulk,
      logPackets: true
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 200000);
    conn.query('DROP TABLE IF EXISTS bigBatchWith16mMaxAllowedPacket');
    conn.query(
      'CREATE TABLE bigBatchWith16mMaxAllowedPacket(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    const values = [];
    for (let i = 0; i < 1000000; i++) {
      values.push([i, str]);
    }
    let res = await conn.batch(
      'INSERT INTO `bigBatchWith16mMaxAllowedPacket` values (1, ?, 2, ?, 3)',
      values
    );
    assert.equal(res.affectedRows, 1000000);

    res = await conn.query(
      'select count(*) as a from `bigBatchWith16mMaxAllowedPacket` WHERE id = 1 AND id3 = 2 AND t = ?',
      [str]
    );
    assert.equal(res[0].a, 1000000);

    res = await conn.query(
      'select COUNT(DISTINCT id2) as a FROM `bigBatchWith16mMaxAllowedPacket` WHERE id2 >= 0 and id2 < 1000000'
    );
    assert.equal(res[0].a, 1000000);

    await conn.query('ROLLBACK');
    clearTimeout(timeout);
    conn.end();
  };

  const bigBatchWith4mMaxAllowedPacket = async (useCompression, useBulk) => {
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      logPackets: true,
      maxAllowedPacket: 4 * 1024 * 1024
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 200000);
    conn.query('DROP TABLE IF EXISTS bigBatchWith4mMaxAllowedPacket');
    conn.query(
      'CREATE TABLE bigBatchWith4mMaxAllowedPacket(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    const values = [];
    for (let i = 0; i < 1000000; i++) {
      values.push([i, str]);
    }
    let res = await conn.batch(
      'INSERT INTO `bigBatchWith4mMaxAllowedPacket` values (1, ?, 2, ?, 3)',
      values
    );
    assert.equal(res.affectedRows, 1000000);

    res = await conn.query(
      'select count(*) as a from `bigBatchWith4mMaxAllowedPacket` WHERE id = 1 AND id3 = 2 AND t = ?',
      [str]
    );
    assert.equal(res[0].a, 1000000);

    res = await conn.query(
      'select COUNT(DISTINCT id2) as a FROM `bigBatchWith4mMaxAllowedPacket` WHERE id2 >= 0 and id2 < 1000000'
    );
    assert.equal(res[0].a, 1000000);

    await conn.query('ROLLBACK');

    clearTimeout(timeout);
    conn.end();
  };

  const bigBatchError = async (useCompression, useBulk) => {
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      logPackets: true
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 200000);
    const values = [];
    for (let i = 0; i < 1000000; i++) {
      values.push([i, str]);
    }
    await conn.query('START TRANSACTION');

    try {
      await conn.batch('INSERT INTO `bigBatchError` values (1, ?, 2, ?, 3)', values);
      throw new Error('must have thrown error !');
    } catch (err) {
      const rows = await conn.query({ sql: 'select 1', bigIntAsNumber: true });
      assert.deepEqual(rows, [{ 1: 1 }]);
      clearTimeout(timeout);
      conn.end();
    }
  };

  const batchWithStream = async (useCompression, useBulk) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      logPackets: true
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    conn.query('DROP TABLE IF EXISTS batchWithStream');
    await conn.query(
      'CREATE TABLE batchWithStream(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    let res = await conn.batch('INSERT INTO `batchWithStream` values (1, ?, 2, ?, ?, 3)', [
      [1, stream1, 99],
      [2, stream2, 98]
    ]);
    assert.equal(res.affectedRows, 2);
    res = await conn.query('select * from `batchWithStream`');
    assert.deepEqual(res, [
      {
        id: 1,
        id2: 1,
        id3: 2,
        t: str,
        id4: 99,
        id5: 3
      },
      {
        id: 1,
        id2: 2,
        id3: 2,
        t: str,
        id4: 98,
        id5: 3
      }
    ]);
    conn.query('DROP TABLE batchWithStream');
    clearTimeout(timeout);
    conn.end();
  };

  const batchErrorWithStream = async (useCompression, useBulk) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    const conn = await base.createConnection({ compress: useCompression, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    try {
      await conn.batch('INSERT INTO batchErrorWithStream values (1, ?, 2, ?, ?, 3)', [
        [1, stream1, 99],
        [2, stream2, 98]
      ]);
      throw new Error('must have thrown error !');
    } catch (err) {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes(" doesn't exist"));
      assert.isTrue(
        err.message.includes('sql: INSERT INTO batchErrorWithStream values (1, ?, 2, ?, ?, 3)')
      );
      assert.equal(err.errno, 1146);
      assert.equal(err.sqlState, '42S02');
      assert.equal(err.code, 'ER_NO_SUCH_TABLE');
      clearTimeout(timeout);
      conn.end();
    }
  };

  const bigBatchErrorWithStreams = async (useCompression, useBulk) => {
    const values = [];
    for (let i = 0; i < 1000000; i++) {
      if (i % 100000 === 0) values.push([i, fs.createReadStream(fileName), i * 2]);
      else values.push([i, str, i * 2]);
    }

    const conn = await base.createConnection({
      compress: useCompression,
      bulk: useBulk,
      logPackets: true
    });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 200000);
    try {
      await conn.batch('INSERT INTO `blabla` values (1, ?, 2, ?, ?, 3)', values);
      throw new Error('must have thrown error !');
    } catch (err) {
      const rows = await conn.query({ sql: 'select 1', bigIntAsNumber: true });
      assert.deepEqual(rows, [{ 1: 1 }]);
      conn.end();
      clearTimeout(timeout);
    }
  };

  const simpleNamedPlaceHolders = async (useBulk) => {
    const conn = await base.createConnection({ namedPlaceholders: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    conn.query('DROP TABLE IF EXISTS simpleNamedPlaceHolders');
    conn.query(
      'CREATE TABLE simpleNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    let res = await conn.batch(
      'INSERT INTO `simpleNamedPlaceHolders` values (1, :param_1, 2, :param_2, 3)',
      [
        { param_1: 1, param_2: 'john' },
        { param_1: 2, param_2: 'jack' }
      ]
    );
    assert.equal(res.affectedRows, 2);
    res = await conn.query('select * from `simpleNamedPlaceHolders`');
    assert.deepEqual(res, [
      {
        id: 1,
        id2: 1,
        id3: 2,
        t: 'john',
        id4: 3
      },
      {
        id: 1,
        id2: 2,
        id3: 2,
        t: 'jack',
        id4: 3
      }
    ]);
    conn.query('DROP TABLE simpleNamedPlaceHolders');
    conn.end();
    clearTimeout(timeout);
  };

  const simpleNamedPlaceHoldersErr = async (useBulk) => {
    const conn = await base.createConnection({ namedPlaceholders: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    try {
      await conn.batch('INSERT INTO blabla values (1, :param_1, 2, :param_2, 3)', [
        { param_1: 1, param_2: 'john' },
        { param_1: 2, param_2: 'jack' }
      ]);
      throw new Error('must have thrown error !');
    } catch (err) {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes(" doesn't exist"));
      assert.isTrue(err.message.includes('sql: INSERT INTO blabla values (1, ?, 2, ?, 3)'));
      assert.equal(err.errno, 1146);
      assert.equal(err.sqlState, '42S02');
      assert.equal(err.code, 'ER_NO_SUCH_TABLE');
      clearTimeout(timeout);
      conn.end();
    }
  };

  const more16MNamedPlaceHolders = async function (useBulk) {
    const conn = await base.createConnection({ namedPlaceholders: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 200000);
    conn.query('DROP TABLE IF EXISTS more16MNamedPlaceHolders');
    conn.query(
      'CREATE TABLE more16MNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLES');
    await conn.query('START TRANSACTION');

    const values = [];
    for (let i = 0; i < 1000000; i++) {
      values.push({ id1: i, id2: str });
    }
    let res = await conn.batch(
      'INSERT INTO `more16MNamedPlaceHolders` values (1, :id1, 2, :id2, 3)',
      values
    );
    assert.equal(res.affectedRows, 1000000);
    res = await conn.query(
      'select count(*) as a from `more16MNamedPlaceHolders` WHERE id = 1 AND id3 = 2 AND t = :t',
      { t: str }
    );
    assert.equal(res[0].a, 1000000);

    res = await conn.query(
      'select COUNT(DISTINCT id2) as a FROM `more16MNamedPlaceHolders` WHERE id2 >= 0 and id2 < 1000000'
    );
    assert.equal(res[0].a, 1000000);

    await conn.query('ROLLBACK');
    clearTimeout(timeout);
    conn.end();
  };

  const streamNamedPlaceHolders = async (useBulk) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    const conn = await base.createConnection({ namedPlaceholders: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    conn.query('DROP TABLE IF EXISTS streamNamedPlaceHolders');
    conn.query(
      'CREATE TABLE streamNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4'
    );
    await conn.query('FLUSH TABLE');
    await conn.query('START TRANSACTION');

    const res = await conn.batch(
      'INSERT INTO `streamNamedPlaceHolders` values (1, :id1, 2, :id3, :id4, 3)',
      [
        { id1: 1, id3: stream1, id4: null, id5: 6 },
        { id1: 2, id3: stream2, id4: 0 }
      ]
    );
    assert.equal(res.affectedRows, 2);
    const rows = await conn.query('select * from `streamNamedPlaceHolders`');
    assert.deepEqual(rows, [
      {
        id: 1,
        id2: 1,
        id3: 2,
        t: str,
        id4: null,
        id5: 3
      },
      {
        id: 1,
        id2: 2,
        id3: 2,
        t: str,
        id4: 0,
        id5: 3
      }
    ]);
    conn.query('DROP TABLE streamNamedPlaceHolders');
    clearTimeout(timeout);
    conn.end();
  };

  const streamErrorNamedPlaceHolders = async (useBulk) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    const conn = await base.createConnection({ namedPlaceholders: true, bulk: useBulk });
    const timeout = setTimeout(() => {
      console.log(conn.info.getLastPackets());
    }, 25000);
    await conn.query('DROP TABLE IF EXISTS blabla');
    await conn.query('CREATE TABLE blabla(i int, i2 int, i3 int, s1 TEXT, s2 TEXT, i4 int)');
    try {
      await conn.batch('INSERT INTO blabla values (1, :id1, 2, :id3, :id7, 3)', [
        { id1: 1, id3: stream1, id4: 99, id5: 6 },
        { id1: 2, id3: stream2, id4: 98 }
      ]);
      throw new Error('must have thrown error !');
    } catch (err) {
      assert.isTrue(err != null);
      assert.isTrue(err.message.includes('Parameter named id7 is not set'));
      assert.isTrue(
        err.message.includes(
          "sql: INSERT INTO blabla values (1, ?, 2, ?, ?, 3) - parameters:{'id1':1,'id3':[object Object],'id4':99,'id5':6}"
        )
      );
      assert.equal(err.errno, 45017);
      assert.equal(err.sqlState, 'HY000');
      assert.equal(err.code, 'ER_PARAMETER_UNDEFINED');
      clearTimeout(timeout);

      await conn.query('DROP TABLE IF EXISTS blabla');
      conn.end();
    }
  };

  describe('standard question mark using bulk', () => {
    it('ensure bulk param length encoded size #137', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await shareConn.query('DROP TABLE IF EXISTS bufLength');
      await shareConn.query('create table bufLength (val TEXT not null, val2 varchar(10))');
      await shareConn.query('FLUSH TABLES');
      await shareConn.batch('update bufLength set val=?, val2=?', [
        [Buffer.alloc(16366).toString(), 'abc']
      ]);
    });

    const useCompression = false;
    it('simple batch, local date', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, true, 'local');
    });

    it('simple batch with option', async function () {
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatchWithOptions(useCompression, true);
    });

    it('batch without value', async function () {
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await noValueBatch(useCompression, true);
    });

    it('batch without parameter', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) {
        this.skip();
        return;
      }
      const conn = await base.createConnection({ compress: useCompression, bulk: true });
      try {
        await conn.batch('INSERT INTO `blabla` values (?)');
        conn.end();
        throw new Error('expect an error !');
      } catch (err) {
        assert.isTrue(err.message.includes('Batch must have values set'), err.message);
        conn.end();
      }
    });

    it('batch with erroneous parameter', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) {
        this.skip();
        return;
      }
      const conn = await base.createConnection({ compress: useCompression, bulk: true });
      await conn.query('DROP TABLE IF EXISTS blabla');
      await conn.query('CREATE TABLE blabla(i int, i2 int)');
      try {
        await conn.batch('INSERT INTO `blabla` values (?, ?)', [
          [1, 2],
          [1, undefined]
        ]);
        conn.end();
        throw new Error('expect an error !');
      } catch (err) {
        assert.isTrue(
          err.message.includes('Parameter at position 1 is not set for values 1') ||
            err.message.includes('Parameter at position 1 is undefined')
        );
        await conn.query('DROP TABLE IF EXISTS blabla');
        conn.end();
      }
    });

    it('simple batch offset date', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, true, timezoneParam);
    });

    it('simple batch offset date Z ', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, true, 'Z');
    });

    it('simple batch encoding CP1251', async function () {
      this.timeout(30000);
      await simpleBatchEncodingCP1251(useCompression, true, 'local');
    });

    it('simple batch error message ', async function () {
      if (process.env.srv === 'skysql-ha') {
        // due to https://jira.mariadb.org/browse/MXS-3196
        this.skip();
        return;
      }
      this.timeout(30000);
      await simpleBatchErrorMsg(useCompression, true);
    });

    it('simple batch error message packet split', async function () {
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatchErrorSplit(useCompression, true, 'local');
    });

    it('non rewritable batch', async function () {
      if (!supportBulk) {
        this.skip();
        return;
      }
      this.timeout(30000);
      await nonRewritableBatch(useCompression, true);
    });

    it('16M+ batch with 16M max_allowed_packet', async function () {
      // skipping in maxscale due to a bug: https://jira.mariadb.org/browse/MXS-3588
      if (process.env.srv === 'maxscale' || process.env.srv === 'skysql-ha') this.skip();
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) return this.skip();
      this.timeout(320000);
      await bigBatchWith16mMaxAllowedPacket(useCompression, true);
    });

    it('16M+ batch with max_allowed_packet set to 4M', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= 4 * 1024 * 1024) {
        this.skip();
        return;
      }
      this.timeout(180000);
      await bigBatchWith4mMaxAllowedPacket(useCompression, true);
    });

    it('16M+ error batch', async function () {
      if (
        process.env.srv === 'skysql' ||
        process.env.srv === 'skysql-ha' ||
        maxAllowedSize <= testSize
      ) {
        this.skip();
      } else {
        await bigBatchError(useCompression, true);
      }
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) {
        this.skip();
      } else {
        this.timeout(30000);
        await batchWithStream(useCompression, true);
      }
    });

    it('batch error with streams', async function () {
      this.timeout(30000);
      await batchErrorWithStream(useCompression, true);
    });

    it('16M+ error batch with streams', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) {
        this.skip();
        return;
      }
      await bigBatchErrorWithStreams(useCompression, true);
    });
  });

  describe('standard question mark and compress with bulk', () => {
    const useCompression = true;

    it('simple batch, local date', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, true, 'local');
    });

    it('simple batch offset date', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, true, timezoneParam);
    });

    it('simple batch error message ', async function () {
      if (process.env.srv === 'skysql-ha') {
        // due to https://jira.mariadb.org/browse/MXS-3196
        this.skip();
        return;
      }
      this.timeout(30000);
      await simpleBatchErrorMsg(useCompression, true);
    });

    it('batch without value', async function () {
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await noValueBatch(useCompression, true);
    });

    it('non rewritable batch', async function () {
      if (!supportBulk) this.skip();
      this.timeout(30000);
      await nonRewritableBatch(useCompression, true);
    });

    it('16M+ batch with 16M max_allowed_packet', async function () {
      // skipping in maxscale due to a bug: https://jira.mariadb.org/browse/MXS-3588
      if (process.env.srv === 'maxscale' || process.env.srv === 'skysql-ha') this.skip();
      if (!RUN_LONG_TEST) this.skip();
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(180000);
      await bigBatchWith16mMaxAllowedPacket(useCompression, true);
    });

    it('16M+ batch with max_allowed_packet set to 4M', async function () {
      if (!RUN_LONG_TEST) this.skip();
      if (maxAllowedSize <= 4 * 1024 * 1024) this.skip();
      this.timeout(180000);
      await bigBatchWith4mMaxAllowedPacket(useCompression, true);
    });

    it('16M+ error batch', async function () {
      if (maxAllowedSize <= testSize) this.skip();
      await bigBatchError(useCompression, true);
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      await batchWithStream(useCompression, true);
    });

    it('batch error with streams', async function () {
      this.timeout(30000);
      await batchErrorWithStream(useCompression, true);
    });

    it('16M+ error batch with streams', async function () {
      if (!RUN_LONG_TEST) this.skip();
      if (maxAllowedSize <= testSize) this.skip();
      await bigBatchErrorWithStreams(useCompression, true);
    });
  });

  describe('standard question mark without bulk', () => {
    const useCompression = false;

    it('simple batch, local date', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, false, 'local');
    });

    it('batch without parameter', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      const conn = await base.createConnection({ compress: useCompression, bulk: false });
      try {
        await conn.batch('INSERT INTO `blabla` values (?)');
        throw new Error('expect an error !');
      } catch (err) {
        assert.isTrue(err.message.includes('Batch must have values set'), err.message);
        conn.end();
      }
    });

    it('rewrite split for maxAllowedPacket', async function () {
      const t = makeid(100);
      const conn = await base.createConnection({ bulk: false, maxAllowedPacket: 150 });
      conn.query('DROP TABLE IF EXISTS my_table');
      conn.query('CREATE TABLE my_table(id int, val LONGTEXT)');
      await conn.query('FLUSH TABLES');
      await conn.batch('INSERT INTO my_table(id,val) VALUES( ?, ?) ', [
        [1, t],
        [2, t]
      ]);
      const res = await conn.query('SELECT * FROM my_table');
      assert.deepEqual(res, [
        { id: 1, val: t },
        { id: 2, val: t }
      ]);
      conn.end();
    });

    it('batch with erroneous parameter', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      const conn = await base.createConnection({ compress: useCompression, bulk: false });
      await conn.query('DROP TABLE IF EXISTS blabla');
      await conn.query('CREATE TABLE blabla(i int, i2 int)');
      try {
        await conn.batch('INSERT INTO `blabla` values (?,?)', [[1, 2], [1]]);
        conn.end();
        throw new Error('expect an error !');
      } catch (err) {
        assert.isTrue(err.message.includes('Parameter at position 1 is not set'), err.message);
        await conn.query('DROP TABLE IF EXISTS blabla');
        conn.end();
      }
    });

    it('batch without value', async function () {
      this.timeout(30000);
      await noValueBatch(useCompression, false);
    });

    it('batch with undefined parameter', async function () {
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      const conn = await base.createConnection({ compress: useCompression, bulk: false });
      await conn.query('DROP TABLE IF EXISTS blabla');
      await conn.query('CREATE TABLE blabla(i int, i2 int)');
      try {
        await conn.batch('INSERT INTO `blabla` values (?,?)', [
          [1, 2],
          [1, undefined]
        ]);
        conn.end();
        throw new Error('expect an error !');
      } catch (err) {
        assert.isTrue(err.message.includes('Parameter at position 1 is undefined'), err.message);
        await conn.query('DROP TABLE IF EXISTS blabla');
        conn.end();
      }
    });

    it('simple batch offset date', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, false, timezoneParam);
    });

    it('simple batch error message ', async function () {
      this.timeout(30000);
      await simpleBatchErrorMsg(useCompression, false);
    });

    it('simple batch error message truncated', async function () {
      this.timeout(30000);
      await displayError(80);
    });

    it('simple batch error message super truncated', async function () {
      this.timeout(30000);
      await displayError(50);
    });

    const displayError = async (debugLen) => {
      const conn = await base.createConnection({ trace: true, bulk: false, debugLen: debugLen });
      const timeout = setTimeout(() => {
        console.log(conn.info.getLastPackets());
      }, 25000);
      try {
        await conn.batch('INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)', [
          [1, 'john"'],
          [2, 'jac"k']
        ]);
        throw new Error('must have thrown error !');
      } catch (err) {
        assert.isTrue(err != null);
        assert.isTrue(err.message.includes(" doesn't exist"));
        const expectedMsg =
          debugLen === 80
            ? 'INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)'
            : 'INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?...';
        assert.isTrue(err.message.includes(expectedMsg));
        assert.equal(err.errno, 1146);
        assert.equal(err.sqlState, '42S02');
        assert.equal(err.code, 'ER_NO_SUCH_TABLE');
        conn.end();
        clearTimeout(timeout);
      }
    };

    it('non rewritable batch', async function () {
      this.timeout(30000);
      await nonRewritableBatch(useCompression, false);
    });

    it('16M+ batch with 16M max_allowed_packet', async function () {
      // skipping in maxscale due to a bug: https://jira.mariadb.org/browse/MXS-3588
      if (process.env.srv === 'maxscale' || process.env.srv === 'skysql-ha') this.skip();
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) return this.skip();
      this.timeout(320000);
      await bigBatchWith16mMaxAllowedPacket(useCompression, false);
    });

    it('16M+ error batch', async function () {
      if (!RUN_LONG_TEST) this.skip();
      if (maxAllowedSize <= testSize) this.skip();
      await bigBatchError(useCompression, false);
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      await batchWithStream(useCompression, false);
    });

    it('batch error with streams', async function () {
      this.timeout(30000);
      await batchErrorWithStream(useCompression, false);
    });

    it('16M+ error batch with streams', async function () {
      if (!RUN_LONG_TEST) this.skip();
      if (maxAllowedSize <= testSize) this.skip();
      await bigBatchErrorWithStreams(useCompression, false);
    });
  });

  describe('standard question mark and compress without bulk', () => {
    const useCompression = true;

    it('simple batch, local date', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, false, 'local');
    });

    it('simple batch offset date', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      if (!shareConn.info.isMariaDB() && !shareConn.info.hasMinVersion(5, 6, 0)) this.skip();
      await simpleBatch(useCompression, false, timezoneParam);
    });

    it('simple batch error message ', async function () {
      this.timeout(30000);
      await simpleBatchErrorMsg(useCompression, false);
    });

    it('batch without value', async function () {
      this.timeout(30000);
      await noValueBatch(useCompression, false);
    });
    it('simple batch error message truncated', async function () {
      this.timeout(30000);
      await displayError(80);
    });

    it('simple batch error message super truncated', async function () {
      this.timeout(30000);
      await displayError(50);
    });

    const displayError = async (debugLen) => {
      const conn = await base.createConnection({ trace: true, bulk: false, debugLen: debugLen });
      const timeout = setTimeout(() => {
        console.log(conn.info.getLastPackets());
      }, 25000);
      try {
        await conn.batch('INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)', [
          [1, 'john"'],
          [2, 'jac"k']
        ]);
        throw new Error('must have thrown error !');
      } catch (err) {
        assert.isTrue(err != null);
        assert.isTrue(err.message.includes(" doesn't exist"));
        const expectedMsg =
          debugLen === 80
            ? 'INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)'
            : 'INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?...';
        assert.isTrue(err.message.includes(expectedMsg));
        assert.equal(err.errno, 1146);
        assert.equal(err.sqlState, '42S02');
        assert.equal(err.code, 'ER_NO_SUCH_TABLE');
        conn.end();
        clearTimeout(timeout);
      }
    };

    it('non rewritable batch', async function () {
      this.timeout(30000);
      await nonRewritableBatch(useCompression, false);
    });

    it('16M+ batch with 16M max_allowed_packet', async function () {
      // skipping in maxscale due to a bug: https://jira.mariadb.org/browse/MXS-3588
      if (process.env.srv === 'maxscale' || process.env.srv === 'skysql-ha') this.skip();
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) return this.skip();
      this.timeout(380000);
      await bigBatchWith16mMaxAllowedPacket(useCompression, false);
    });

    it('16M+ error batch', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) {
        return this.skip();
      }
      await bigBatchError(useCompression, false);
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) {
        this.skip();
        return;
      }
      this.timeout(30000);
      await batchWithStream(useCompression, false);
    });

    it('batch error with streams', async function () {
      this.timeout(30000);
      await batchErrorWithStream(useCompression, false);
    });

    it('16M+ error batch with streams', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) {
        this.skip();
        return;
      }
      await bigBatchErrorWithStreams(useCompression, false);
    });
  });

  describe('named parameter with bulk', () => {
    it('simple batch', async function () {
      this.timeout(30000);
      await simpleNamedPlaceHolders(true);
    });

    it('simple batch error', async function () {
      if (process.env.srv === 'skysql-ha') {
        // due to https://jira.mariadb.org/browse/MXS-3196
        this.skip();
        return;
      }
      this.timeout(30000);
      await simpleNamedPlaceHoldersErr(true);
    });

    it('16M+ batch', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) return this.skip();
      this.timeout(320000);
      await more16MNamedPlaceHolders(true);
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      await streamNamedPlaceHolders(true);
    });

    it('batch error with streams', async function () {
      this.timeout(30000);
      await streamErrorNamedPlaceHolders(true);
    });
  });

  describe('named parameter without bulk', () => {
    it('simple batch', async function () {
      this.timeout(30000);
      await simpleNamedPlaceHolders(false);
    });

    it('simple batch error', async function () {
      this.timeout(30000);
      await simpleNamedPlaceHoldersErr(false);
    });

    it('16M+ batch', async function () {
      if (!RUN_LONG_TEST || maxAllowedSize <= testSize) return this.skip();
      this.timeout(320000);
      await more16MNamedPlaceHolders(false);
    });

    it('batch with streams', async function () {
      if (!base.utf8Collation()) this.skip();
      this.timeout(30000);
      await streamNamedPlaceHolders(false);
    });

    it('batch error with streams', async function () {
      if (!RUN_LONG_TEST) this.skip();
      this.timeout(30000);
      await streamErrorNamedPlaceHolders(false);
    });
  });
});

function makeid(length) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
