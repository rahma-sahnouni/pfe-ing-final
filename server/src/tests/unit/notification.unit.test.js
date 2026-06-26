'use strict';
/**
 * Tests UNITAIRES — notification.controller.js
 * Le modèle Notification est entièrement mocké — aucune connexion à une base de données.
 */

jest.mock('../../models/notification.model');

const Notification = require('../../models/notification.model');
const { getNotifications, markAllRead } = require('../../controllers/notification.controller');

// ── helpers ───────────────────────────────────────────────────────────────────

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('getNotifications', () => {

  test('200 — retourne les notifications de l\'utilisateur connecté', async () => {
    const userId = 'uid-1';
    const fakeNotifs = [
      { _id: 'n1', userId, message: 'Pour moi 1', read: false },
      { _id: 'n2', userId, message: 'Pour moi 2', read: false },
    ];
    Notification.find.mockReturnValue({
      sort:  jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(fakeNotifs),
    });

    const req = { user: { _id: userId } };
    const res = buildRes();
    await getNotifications(req, res, jest.fn());

    expect(Notification.find).toHaveBeenCalledWith({ userId });
    expect(res.json).toHaveBeenCalledWith(fakeNotifs);
    expect(res.json.mock.calls[0][0]).toHaveLength(2);
  });

  test('200 — retourne un tableau vide si aucune notification', async () => {
    Notification.find.mockReturnValue({
      sort:  jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: 'uid-empty' } };
    const res = buildRes();
    await getNotifications(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith([]);
  });

  test('applique une limite à 50 et un tri décroissant', async () => {
    const sortMock  = jest.fn().mockReturnThis();
    const limitMock = jest.fn().mockResolvedValue([]);
    Notification.find.mockReturnValue({ sort: sortMock, limit: limitMock });

    const req = { user: { _id: 'uid-1' } };
    const res = buildRes();
    await getNotifications(req, res, jest.fn());

    expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
    expect(limitMock).toHaveBeenCalledWith(50);
  });

  test('filtre uniquement par userId — pas de fuite entre utilisateurs', async () => {
    const userId = 'uid-mine';
    Notification.find.mockReturnValue({
      sort:  jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: userId } };
    const res = buildRes();
    await getNotifications(req, res, jest.fn());

    expect(Notification.find).toHaveBeenCalledWith({ userId });
  });

});

// ════════════════════════════════════════════════════════════════════════════
describe('markAllRead', () => {

  test('200 — marque toutes les notifications non lues comme lues', async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const req = { user: { _id: 'uid-1' }, body: {} };
    const res = buildRes();
    await markAllRead(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(Notification.updateMany).toHaveBeenCalledWith(
      { userId: 'uid-1', read: false },
      { $set: { read: true } }
    );
  });

  test('filtre par type quand req.body.types est fourni', async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const req = { user: { _id: 'uid-1' }, body: { types: ['RH_TEST_ASSIGNMENT'] } };
    const res = buildRes();
    await markAllRead(req, res, jest.fn());

    expect(Notification.updateMany).toHaveBeenCalledWith(
      { userId: 'uid-1', read: false, type: { $in: ['RH_TEST_ASSIGNMENT'] } },
      { $set: { read: true } }
    );
  });

  test('sans types fourni — le filtre n\'inclut pas le champ type', async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const req = { user: { _id: 'uid-1' }, body: {} };
    const res = buildRes();
    await markAllRead(req, res, jest.fn());

    const calledFilter = Notification.updateMany.mock.calls[0][0];
    expect(calledFilter).not.toHaveProperty('type');
  });

  test('ne touche pas les notifications des autres utilisateurs (filtre userId strict)', async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const req = { user: { _id: 'uid-mine' }, body: {} };
    const res = buildRes();
    await markAllRead(req, res, jest.fn());

    const calledFilter = Notification.updateMany.mock.calls[0][0];
    expect(calledFilter.userId).toBe('uid-mine');
  });

});
