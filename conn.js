const mysql = require('mysql');

const conn = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'catering_service'
});

conn.connect((err) => {
    if (err) throw err;
    console.log("Connected to MySQL Database: catering_service");
});

module.exports = conn;