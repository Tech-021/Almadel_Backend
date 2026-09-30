const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { prisma } = require("../../db");
const { verifyAccessToken } = require("../auth/token.service");
const { isAllowedCorsOrigin } = require("../../utils/cors-origins");
const { isRedisEnabled, createPubSubClients } = require("../../utils/redis");
const { logger } = require("../../utils/logger");

let ioInstance = null;

async function authenticateSocket(socket, next) {
  try {
    const authToken = socket.handshake.auth?.token;
    const authorization = socket.handshake.headers?.authorization;
    const token = authToken || (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
    if (!token) return next(new Error("Authentication required."));
    const payload = verifyAccessToken(token);
    const userId = Number(payload.id);
    if (!Number.isInteger(userId) || userId <= 0) return next(new Error("Invalid session."));
    const user = await prisma.user.findUnique({
      select: { id: true, authVersion: true, email: true, fullName: true, role: true },
      where: { id: userId },
    });
    if (!user || user.authVersion !== Number(payload.authVersion ?? 0)) return next(new Error("Invalid or expired session."));
    socket.user = user;
    return next();
  } catch {
    return next(new Error("Invalid or expired session."));
  }
}

async function joinBusiness(socket, businessId) {
  const id = Number(businessId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid business id.");
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: id, userId: socket.user.id } },
    select: { businessId: true, role: true },
  });
  if (!membership) throw new Error("You do not have access to this business.");
  if (socket.businessId) socket.leave(`business:${socket.businessId}`);
  socket.businessId = id;
  socket.businessRole = membership.role;
  await socket.join(`business:${id}`);
  return { businessId: id, role: membership.role };
}

async function registerSocketHandlers(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      credentials: true,
      origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
    },
    maxHttpBufferSize: 1e6,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    transports: ["websocket", "polling"],
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
  });

  io.engine.on("connection_error", (error) => {
    console.error("Socket.IO connection error:", {
      message: error.message,
      code: error.code,
      context: error.context,
    });
  });

  if (isRedisEnabled()) {
    try {
      const pair = await createPubSubClients();
      if (pair) {
        io.adapter(createAdapter(pair.pubClient, pair.subClient));
        logger.info("Socket.IO Redis adapter enabled");
      } else {
        logger.info("Redis optional adapter skipped (using in-memory): client unavailable");
      }
    } catch (err) {
      logger.info("Redis optional adapter skipped (using in-memory):", err.message);
    }
  } else {
    logger.info("Socket.IO using in-memory adapter (ENABLE_REDIS not true)");
  }

  io.use(authenticateSocket);
  io.on("connection", async (socket) => {
    await socket.join(`user:${socket.user.id}`);
    const requestedBusiness = socket.handshake.auth?.businessId;
    if (requestedBusiness) {
      try {
        await joinBusiness(socket, requestedBusiness);
      } catch (error) {
        socket.emit("realtime.error", { message: error.message });
      }
    }
    socket.on("business.join", async (businessId, callback) => {
      try {
        const result = await joinBusiness(socket, businessId);
        if (typeof callback === "function") callback({ ok: true, ...result });
      } catch (error) {
        if (typeof callback === "function") callback({ ok: false, message: error.message });
      }
    });
  });

  ioInstance = io;
  return io;
}

function emitBusinessEvent(businessId, event, payload) {
  if (ioInstance && businessId) ioInstance.to(`business:${businessId}`).emit(event, payload);
}

module.exports = { emitBusinessEvent, registerSocketHandlers };


