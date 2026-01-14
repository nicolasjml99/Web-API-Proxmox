const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.static('public'));
app.use(express.json());

/* ================= CONFIG ================= */
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const PROXMOX_IP = config.proxmox_ip;
const NODE_NAME = config.node_name;
const TOKEN_ID = config.token_id;
const TOKEN_SECRET = config.token_secret;
const vmConfig = config.vms;
const allowedVMs = Object.keys(vmConfig).map(Number);

/* ================= CLIENTE PROXMOX ================= */
const proxmox = axios.create({
  baseURL: `https://${PROXMOX_IP}:8006/api2/json`,
  headers: { Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}` },
  httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

/* ================= LISTAR VMS ================= */
app.get('/vms', async (req, res) => {
  try {
    const { data } = await proxmox.get(`/nodes/${NODE_NAME}/qemu`);

    const vms = data.data
      .filter(vm => allowedVMs.includes(vm.vmid))
      .map(vm => ({
        vmid: vm.vmid,
        name: vmConfig[vm.vmid]?.name || vm.name,
        status: vm.status,
        os: vmConfig[vm.vmid]?.os || 'unknown'
      }))
      .sort((a, b) => a.vmid - b.vmid); // orden ascendente por VMID

    res.json(vms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= CONTROL VM ================= */
async function controlVM(vmid, action, res) {
  if (!allowedVMs.includes(vmid)) return res.status(403).json({ error: 'VM no permitida' });
  try {
    await proxmox.post(`/nodes/${NODE_NAME}/qemu/${vmid}/status/${action}`);
    res.json({ status: action });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

['start','shutdown','reboot','stop','reset'].forEach(action => {
  app.post(`/vms/:vmid/${action}`, (req,res)=>controlVM(parseInt(req.params.vmid),action,res));
});

/* ================= ENLACE CONSOLA ================= */
app.get('/vms/:vmid/open', async (req, res) => {
  const vmid = parseInt(req.params.vmid);
  if (!allowedVMs.includes(vmid)) return res.status(403).json({ error: 'VM no permitida' });
  try {
    const { data } = await proxmox.post(`/nodes/${NODE_NAME}/qemu/${vmid}/vncproxy`);
    res.json({
      url: `https://${PROXMOX_IP}:8006/?console=kvm&novnc=1&vmid=${vmid}&node=${NODE_NAME}&vncticket=${encodeURIComponent(data.data.ticket)}`
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= INICIAR SERVIDOR ================= */
app.listen(3000, () => console.log('Servidor iniciado en http://192.168.0.143:3000'));
