const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- API Routes ---

// Register
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 8);

    db.run(`INSERT INTO users (username, password, last_active) VALUES (?, ?, ?)`,
        [username, hashedPassword, Date.now()],
        function (err) {
            if (err) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            const userId = this.lastID;
            res.json({ id: userId, username });
        }
    );
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'User not found' });
        }

        const passwordIsValid = bcrypt.compareSync(password, user.password);
        if (!passwordIsValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        res.json({ id: user.id, username: user.username });
    });
});

// Update Location
app.post('/api/update-location', (req, res) => {
    const { userId, lat, lng } = req.body;
    db.run(`UPDATE users SET lat = ?, lng = ?, last_active = ? WHERE id = ?`,
        [lat, lng, Date.now(), userId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Broadcast location update to all clients
            io.emit('location_update', { userId, lat, lng });
            res.json({ success: true });
        }
    );
});

// Get Nearby Users (Simulated "nearby" by returning all active users)
app.get('/api/users', (req, res) => {
    // Return users active in last 1 hour
    const oneHourAgo = Date.now() - 3600000;
    db.all(`SELECT id, username, lat, lng FROM users WHERE last_active > ?`, [oneHourAgo], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- Socket.io (Chat) ---

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('join', (userId) => {
        socket.join(userId); // Join a room named after the user ID
    });

    socket.on('send_message', (data) => {
        const { senderId, receiverId, content } = data;
        const timestamp = Date.now();

        // Save to DB
        db.run(`INSERT INTO messages (sender_id, receiver_id, content, timestamp) VALUES (?, ?, ?, ?)`,
            [senderId, receiverId, content, timestamp],
            (err) => {
                if (!err) {
                    // Emit to receiver
                    io.to(receiverId).emit('receive_message', {
                        senderId,
                        content,
                        timestamp
                    });
                    // Emit back to sender (for UI confirmation)
                    io.to(senderId).emit('message_sent', {
                        receiverId,
                        content,
                        timestamp
                    });
                }
            }
        );
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
