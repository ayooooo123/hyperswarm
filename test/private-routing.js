const test = require('brittle')
const DHT = require('hyperdht')
const b4a = require('b4a')

const Hyperswarm = require('..')

function privateRouting(relay) {
  return {
    release: 'alpha',
    acknowledgeAlpha: true,
    mode: 'optional',
    profile: 'standard',
    relay
  }
}

test(
  'private routing carries Hyperswarm peer streams without direct destination dials',
  { timeout: 120000 },
  async (t) => {
    const boot = new DHT({
      bootstrap: [],
      host: '127.0.0.1',
      port: 0,
      ephemeral: false,
      firewalled: false
    })
    await boot.ready()
    const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
    const nodes = [false, false, true, true, true, true].map(
      (relay) =>
        new DHT({
          bootstrap,
          host: '127.0.0.1',
          port: 0,
          ephemeral: false,
          firewalled: false,
          privateRouting: privateRouting(relay)
        })
    )
    await Promise.all(nodes.map((node) => node.ready()))
    await Promise.all(nodes.map((node) => node.privateRouting.ready()))

    const serverSwarm = new Hyperswarm({ dht: nodes[1], privateRouting: true })
    const clientSwarm = new Hyperswarm({ dht: nodes[0], privateRouting: true })
    t.teardown(async () => {
      await Promise.allSettled([clientSwarm.destroy(), serverSwarm.destroy()])
      await Promise.allSettled(nodes.slice(2).map((node) => node.destroy({ force: true })))
      await boot.destroy({ force: true })
    })

    const payload = b4a.from('hyperswarm private route')
    const received = new Promise((resolve, reject) => {
      clientSwarm.once('connection', (socket, info) => {
        socket.on('error', reject)
        t.alike(info.publicKey, serverSwarm.keyPair.publicKey)
        socket.once('data', resolve)
        socket.write(payload)
      })
    })

    serverSwarm.on('connection', (socket) => {
      socket.on('error', () => {})
      socket.on('data', (data) => socket.write(data))
    })

    const topic = b4a.alloc(32, 0x71)
    await serverSwarm.join(topic, { server: true, client: false }).flushed()
    clientSwarm.join(topic, { server: false, client: true })

    t.alike(await received, payload)
    t.is(
      clientSwarm.dht.privateRouting.exposureReport().directDestinationSends,
      0,
      'Hyperswarm connection selection never dials the destination key directly'
    )
  }
)
