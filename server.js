const express = require('express')
const jwt = require('jsonwebtoken')
const cors = require('cors')
const bodyParser = require('body-parser')
const crypto = require('crypto')
const moment = require('moment')

// Mongo DB
const MongoClient = require('mongodb').MongoClient
const url = 'mongodb://localhost:8081/'

// Google Storage
const { Storage } = require('@google-cloud/storage')
const storage = new Storage({
	projectId: 'setis-gateway-api',
	keyFilename: './setis-gateway-api-dff6ace9d009.json'
})
const bucketName = 'setis-gateway-api'

const app = express()
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// ------------------------------ M O N G O   C A L L S --------------------------
function findAllInMongo() {
	return new Promise(resolve => {
		MongoClient.connect(url, { useNewUrlParser: true }, (err, db) => {
			if (err) throw err
			var dbo = db.db('secret')
			dbo
				.collection('secret')
				.find({}, { projection: { _id: 0 } })
				.toArray(function(err, result) {
					if (err) throw err
					const resultsInArray = result.map(row => row.key)
					console.log('-- searching in Mongo...')
					db.close()
					resolve(resultsInArray)
				})
		})
	})
}

function insertInMongo(secretKey) {
	MongoClient.connect(url, { useNewUrlParser: true }, function(err, db) {
		if (err) throw err
		var dbo = db.db('secret')
		var myobj = { key: secretKey }
		dbo.collection('secret').insertOne(myobj, (err, res) => {
			if (err) {
				throw err
			} else {
				console.log('-- storing key in Mongo...')
			}
			db.close()
		})
	})
}

function removeFromMongo(secretKey) {
	return new Promise(resolve => {
		MongoClient.connect(url, { useNewUrlParser: true }, function(err, db) {
			if (err) {
				throw err
			}
			var dbo = db.db('secret')
			console.log(secretKey)
			var myquery = { key: secretKey }
			dbo.collection('secret').deleteOne(myquery, (err, obj) => {
				db.close()
				if (err) {
					resolve(false)
				} else {
					console.log('-- old key removed -')
					resolve(true)
				}
			})
		})
	})
}

// ---------------------------------- H E L P E R S  ------------------------------

function generateSecretKey() {
	console.log('- generating secret key...')
	let secretKey = crypto.randomBytes(100).toString('hex')
	insertInMongo(secretKey)
	return secretKey
}

function generateJWT(secretKey) {
	return new Promise((resolve, reject) => {
		console.log('- generating new jwt token...')
		jwt.sign({ secretKey }, 'secretkey', (err, token) => {
			if (err) {
				return reject(err)
			}
			return resolve(token)
		})
	})
}

async function validateTokenAndSecretKey(req, res, next) {
	// Get all the SECRET KEYS in our database
	let ourKeys = await findAllInMongo()
	let token = req.headers.token

	// Decrypt incoming TOKEN and compare the hidden SECRET KEY to ours
	jwt.verify(token, 'secretkey', (err, authData) => {
		if (err) {
			console.log('- Error: mismatch jwt')
			res.send('mismatch jwt')
		} else if (!ourKeys.includes(authData.secretKey)) {
			console.log('- Error: missmatch secret key')
			console.log('- our keys:', ourKeys)
			console.log('- their key:', authData.secretKey)
			res.send('mismatch secretKey')
		} else {
			console.log('- Success: jwt and secret key matched!')
			res.locals.secretKey = authData.secretKey
			next()
		}
	})
}

// ------------------------------ S E R V E R   C A L L S --------------------------
app.listen(8080, () => console.log('App is listening on port 8080 '))

app.get('/register', (req, res) => {
	console.log('Generating token on first contact...')

	// Generate new SECRET KEY and generate new TOKEN
	generateJWT(generateSecretKey())
		.then(newToken => {
			res.json({
				newKey: true,
				token: newToken
			})
		})
		.catch(err => {
			console.log(err)
		})
})

app.get('/api/:data', cors(), validateTokenAndSecretKey, (req, res) => {
	res.setHeader('Access-Control-Allow_origin', '*')
	let data = req.params.data
	if (uploadData(data) === 'done') {
		res.send('data uploaded successfully')
	}
	res.send('error uploading data')
})

app.post('/changeKey', validateTokenAndSecretKey, async (req, res) => {
	// Remove old SECRET KEY
	let keyIsRemoved = await removeFromMongo(res.locals.secretKey)
	if (!keyIsRemoved) {
		res.sendStatus(403)
	}

	// Generate new SECRET KEY and generate new TOKEN
	generateJWT(generateSecretKey())
		.then(newToken => {
			res.json({
				newKey: true,
				token: newToken
			})
		})
		.catch(err => {
			console.log(err)
		})
})

// -------------------------------- A P I   C A L L S --------------------------

// set timeout to avoid limit request rates
const delay = interval => new Promise(resolve => setTimeout(resolve, interval))

function uploadData(data) {
	return new Promise(async resolve => {
		await delay(1000)

		console.log('--> Uploading data...')
		const Readable = require('stream').Readable
		const s = new Readable()
		s.push(JSON.stringify(data))
		s.push(null)

		const dateTime = moment()
		const destination = 'uploaded: ' + dateTime
		let file = storage.bucket(bucketName).file(destination)
		s.pipe(file.createWriteStream()).on('finish', () => {
			resolve('done')
		})
	})
}
