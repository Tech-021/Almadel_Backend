const jwt = require("jsonwebtoken");

function jwtSecret() {
  return process.env.JWT_SECRET ?? "change-this-secret";
}

function createAccessToken(user) {
  return jwt.sign(
    {
      authVersion: user.authVersion ?? 0,
      id: user.id,
      role: user.role,
    },
    jwtSecret(),
    { expiresIn: "7d" },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret());
}

module.exports = { createAccessToken, verifyAccessToken };
