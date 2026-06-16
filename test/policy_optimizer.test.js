import { BeliefBase } from '../src/agent/BeliefBase.js';
import { optimizeDeliveryStack } from '../src/policy/DeliveryOptimizer.js';
import { evaluatePolicyReward } from '../src/policy/PolicyEngine.js';

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ Assertion failed: ${message}`);
        process.exit(1);
    }
    console.log(`✅ Passed: ${message}`);
}

async function runTests() {
    console.log('=== Running Policy & Optimizer Unit Tests ===');

    // Case 1: Testing evaluatePolicyReward with basic rules
    {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        // Rule: If parcel reward >= 11, multiplier is 0 (Forbidden values)
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [],
                rewardBounds: [{ min: 11, max: null }],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Verify rules parsing
        assert(beliefs.policyRules.rules.length === 1, 'Rule should be applied to beliefs');

        // Test evaluations
        const reward10 = evaluatePolicyReward(beliefs, 10, { parcel: { reward: 10 } });
        assert(reward10 === 10, `Reward of 10 should remain 10 (got ${reward10})`);

        const reward15 = evaluatePolicyReward(beliefs, 15, { parcel: { reward: 15 } });
        assert(reward15 === 0, `Reward of 15 should be zeroed out (got ${reward15})`);
    }

    // Case 2: Testing DeliveryOptimizer with reward decay waiting
    {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        beliefs.parcelDecayIntervalMs = 1000; // 1s per decay point
        
        // Rule: If parcel reward >= 11, multiplier is 0 (Forbidden values)
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [],
                rewardBounds: [{ min: 11, max: null }],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // We have a carried parcel with reward 20.
        // It should wait until it decays below 11 (decay 20 -> 10.9, which is 9.1 decay steps, so wait 9.1s = 9100ms)
        const carriedParcels = [
            { id: 'p1', reward: 20 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carriedParcels, 5, 5);
        console.log('Optimizer Output (Wait Case):', opt);
        
        assert(opt.bestSubset.includes('p1'), 'Should deliver p1');
        assert(opt.bestWaitMs > 0, `Should wait for decay (got ${opt.bestWaitMs}ms)`);
        
        const expectedWaitMs = (20 - 10.9) * 1000; // 9.1s
        assert(Math.abs(opt.bestWaitMs - expectedWaitMs) < 200, `Wait time should be around 9100ms (got ${opt.bestWaitMs}ms)`);
        assert(opt.bestReward > 0, `Should get a positive reward (got ${opt.bestReward})`);
    }

    // Case 3: Testing DeliveryOptimizer with stack size limits
    {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        // Rule: Deliver EXACTLY 3 parcels (otherwise multiplier is 0)
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }, { min: 4, max: null }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // We carry 4 parcels
        const carriedParcels = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carriedParcels, 5, 5);
        console.log('Optimizer Output (Stack Case):', opt);

        assert(opt.bestSubset.length === 3, `Should select exactly 3 parcels (got ${opt.bestSubset.length})`);
        assert(opt.discardSubset.length === 0, `Should NOT discard remaining parcel (got ${opt.discardSubset.length})`);
        assert(opt.bestReward === 30, `Should get reward 30 (got ${opt.bestReward})`);
    }

    // Case 4: Testing DeliveryOptimizer with custom tiles rules
    {
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        // Rule: Deliver at (2, 2) has 2x multiplier, but deliver at (5, 5) has 0x multiplier
        const rules = [
            {
                all_tiles: false,
                tiles: ['5,5'],
                stackSizeBounds: [],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            },
            {
                all_tiles: false,
                tiles: ['2,2'],
                stackSizeBounds: [],
                rewardBounds: [],
                multiplier: 2,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        const carriedParcels = [
            { id: 'p1', reward: 10 }
        ];

        // Evaluating at (5, 5) - should give 0 reward
        const opt5 = optimizeDeliveryStack(beliefs, carriedParcels, 5, 5);
        assert(opt5.bestReward === 0, `Should get reward 0 at (5, 5) (got ${opt5.bestReward})`);

        // Evaluating at (2, 2) - should give 20 reward
        const opt2 = optimizeDeliveryStack(beliefs, carriedParcels, 2, 2);
        assert(opt2.bestReward === 20, `Should get reward 20 at (2, 2) (got ${opt2.bestReward})`);
    }

    // Case 5: Direct minReward and maxReward rule properties
    {
        console.log('--- Testing Case 5: Direct minReward/maxReward Rule Properties ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        // Rule with direct minReward property instead of rewardBounds array
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [],
                minReward: 11,
                maxReward: null,
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Verify rule parameters extracted
        assert(beliefs.policyRules.maxRewardLimit === 11, `maxRewardLimit should be extracted as 11 (got ${beliefs.policyRules.maxRewardLimit})`);

        // Test evaluatePolicyReward
        const r10 = evaluatePolicyReward(beliefs, 10, { parcel: { reward: 10 } });
        assert(r10 === 10, `Reward of 10 should be allowed (got ${r10})`);

        const r15 = evaluatePolicyReward(beliefs, 15, { parcel: { reward: 15 } });
        assert(r15 === 0, `Reward of 15 should be zeroed (got ${r15})`);
    }

    // Case 6: Dynamic decay tracking
    {
        console.log('--- Testing Case 6: Dynamic Decay Tracking ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        beliefs.observationDistance = 5;

        // Sense parcel p1 first time
        beliefs._reviseParcelsSpatialMemory([
            { id: 'p1', x: 5, y: 5, reward: 20, carriedBy: null }
        ]);

        // Manually adjust the timestamp of the first observation to be 1000ms in the past
        const p1 = beliefs.parcels.get('p1');
        p1.lastRewardChangeTime = Date.now() - 1000;

        // Sense parcel p1 second time with decayed reward (decayed by 2 points over 1000ms => interval is 500ms)
        beliefs._reviseParcelsSpatialMemory([
            { id: 'p1', x: 5, y: 5, reward: 18, carriedBy: null }
        ]);

        assert(Math.abs(beliefs.parcelDecayIntervalMs - 500) < 50, `parcelDecayIntervalMs should dynamically update close to 500ms (got ${beliefs.parcelDecayIntervalMs.toFixed(0)}ms)`);
    }

    // Case 7: Keep non-useless parcels in inventory (do not discard them if they can decay to allowed range)
    {
        console.log('--- Testing Case 7: Preserving Non-Useless Parcels in Inventory ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        beliefs.parcelDecayIntervalMs = 1000; // 1s per decay point

        // Rule: value must be <= 10 (forbidden range is 11 to null)
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [],
                minReward: 11,
                maxReward: null,
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Carrying p1 (value 10, already allowed) and p2 (value 30, disallowed right now but decays to 10 in 20s)
        const carried = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 30 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carried, 5, 5);
        console.log('Optimizer Output (Case 7):', opt);

        assert(opt.bestSubset.includes('p1'), 'Should deliver p1 now');
        assert(!opt.bestSubset.includes('p2'), 'Should not deliver p2 yet');
        assert(opt.bestWaitMs === 0, `Should not wait for p2 to decay (got wait ${opt.bestWaitMs}ms)`);
        assert(!opt.discardSubset.includes('p2'), 'Should NOT discard p2 (since it can decay to 10)');
        assert(opt.discardSubset.length === 0, 'No parcels should be discarded');
    }

    // Case 8: Batch-by-batch delivery loop simulation
    {
        console.log('--- Testing Case 8: Batch-by-batch Delivery Loop Simulation ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        // Rule: cannot deliver 1 at a time (multiplier 0 for size < 2) and cannot deliver > 3 at a time (multiplier 0 for size >= 4)
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 2 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            },
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 4, max: null }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // We carry 5 parcels
        const carried = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 }
        ];

        // 1st Iteration: Should select exactly 3 parcels (leaving 2 in inventory)
        const opt1 = optimizeDeliveryStack(beliefs, carried, 5, 5);
        assert(opt1.bestSubset.length === 3, `1st iteration should select exactly 3 parcels (got ${opt1.bestSubset.length})`);
        assert(opt1.discardSubset.length === 0, `No parcels should be discarded as useless in 1st iteration (got ${opt1.discardSubset.length})`);
        assert(opt1.bestReward === 30, `1st iteration should get reward 30 (got ${opt1.bestReward})`);

        // 2nd Iteration: Simulate remaining 2 parcels in inventory
        const remaining = carried.filter(p => !opt1.bestSubset.includes(p.id));
        assert(remaining.length === 2, `Should have 2 parcels remaining (got ${remaining.length})`);

        const opt2 = optimizeDeliveryStack(beliefs, remaining, 5, 5);
        assert(opt2.bestSubset.length === 2, `2nd iteration should select exactly 2 parcels (got ${opt2.bestSubset.length})`);
        assert(opt2.discardSubset.length === 0, `No parcels should be discarded in 2nd iteration`);
        assert(opt2.bestReward === 20, `2nd iteration should get reward 20 (got ${opt2.bestReward})`);
    }

    // Case 9: Island Connection & RELAY Proposal Detection
    {
        console.log('--- Testing Case 9: Island Connection & RELAY Proposal Detection ---');
        
        // Import MapRepresentation and IntentionEngine
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { IntentionEngine } = await import('../src/agent/Intentions.js');

        // Create a 1D grid layout representing a corridor with one-way arrows
        // We make a 10x10 map
        // Row 4 will be our corridor: (0,4) to (9,4)
        // Others will be walls (type '0')
        const tiles = [];
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                if (y === 4) {
                    if (x === 1) {
                        tiles.push({ x, y, type: '1' }); // Spawn zone at (1,4)
                    } else if (x === 7) {
                        tiles.push({ x, y, type: '2' }); // Delivery zone at (7,4)
                    } else if (x === 3) {
                        tiles.push({ x, y, type: '→' }); // Arrow pointing right at (3,4)
                    } else if (x === 5) {
                        tiles.push({ x, y, type: '←' }); // Arrow pointing left at (5,4)
                    } else {
                        tiles.push({ x, y, type: '3' }); // Pavement
                    }
                } else {
                    tiles.push({ x, y, type: '0' }); // Wall
                }
            }
        }

        const map = new MapRepresentation(9, 9, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', name: 'Agent BDI', x: 1, y: 4, score: 0 };
        beliefs.peers = new Map([
            ['agent_2', { id: 'agent_2', name: 'Agent LLM', x: 7, y: 4, score: 0 }]
        ]);
        beliefs.activeContracts = new Map();

        // Mock socket that records proposed contracts
        let proposedContract = null;
        const mockSocket = {
            async emitSay(recipient, message) {
                const parsed = JSON.parse(message);
                if (parsed.type === 'PROPOSE_CONTRACT') {
                    proposedContract = parsed;
                }
            }
        };

        const engine = new IntentionEngine(beliefs, mockSocket);

        // Run the detection
        await engine._checkAndProposeRelayContract();

        assert(proposedContract !== null, 'Should propose a contract');
        assert(proposedContract.contractType === 'RELAY', `Contract type should be RELAY (got ${proposedContract.contractType})`);
        assert(proposedContract.x === 4 && proposedContract.y === 4, `Drop tile should be (4,4) (got (${proposedContract.x}, ${proposedContract.y}))`);
        assert(proposedContract.courierId === 'agent_1', `Courier should be agent_1 (BDI) since it can reach spawn (got ${proposedContract.courierId})`);
    }

    // Case 10: Delivery Zone Occupancy check
    {
        console.log('--- Testing Case 10: Delivery Zone Occupancy check ---');

        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { findNearestDeliveryZone } = await import('../src/agent/PlanLibrary.js');

        // Create a 10x10 map with two delivery zones: (3, 3) and (7, 7)
        const tiles = [];
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                if ((x === 3 && y === 3) || (x === 7 && y === 7)) {
                    tiles.push({ x, y, type: '2' }); // Delivery zones
                } else {
                    tiles.push({ x, y, type: '3' }); // Pavement
                }
            }
        }
        const map = new MapRepresentation(9, 9, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', x: 2, y: 2 };

        // Scenario 1: No peers. Closest zone is (3,3) (distance = 2). (7,7) is distance = 10.
        beliefs.peers = new Map();
        const zone1 = findNearestDeliveryZone(beliefs, 2, 2);
        assert(zone1 !== null && zone1.x === 3 && zone1.y === 3, `Should select (3,3) as it is closer and free (got ${zone1 ? `${zone1.x},${zone1.y}` : 'null'})`);

        // Scenario 2: Peer is occupying (3,3). Best zone should be (7,7) even though it is further away.
        beliefs.peers = new Map([
            ['agent_2', { id: 'agent_2', x: 3, y: 3 }]
        ]);
        const zone2 = findNearestDeliveryZone(beliefs, 2, 2);
        assert(zone2 !== null && zone2.x === 7 && zone2.y === 7, `Should select (7,7) because (3,3) is occupied (got ${zone2 ? `${zone2.x},${zone2.y}` : 'null'})`);

        // Scenario 3: All delivery zones are occupied. It should fall back to the closest occupied one (3,3).
        beliefs.peers = new Map([
            ['agent_2', { id: 'agent_2', x: 3, y: 3 }],
            ['agent_3', { id: 'agent_3', x: 7, y: 7 }]
        ]);
        const zone3 = findNearestDeliveryZone(beliefs, 2, 2);
        assert(zone3 !== null && zone3.x === 3 && zone3.y === 3, `Should fall back to closest occupied (3,3) when all are occupied (got ${zone3 ? `${zone3.x},${zone3.y}` : 'null'})`);
    }

    // Case 11: Policy rule: you cannot deliver less than 3 parcels at a time (multiplier 0 for size < 3)
    {
        console.log('--- Testing Case 11: Policy "cannot deliver less than 3 parcels" ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 5, y: 5 };
        
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Scenario A: Carrying 1 parcel. Delivering it is forbidden.
        const carried1 = [{ id: 'p1', reward: 10 }];
        const opt1 = optimizeDeliveryStack(beliefs, carried1, 5, 5);
        console.log('Optimizer Output (Case 11 - 1 parcel):', opt1);
        assert(opt1.bestSubset.length === 0, `Should NOT deliver when carrying 1 parcel (got subset length ${opt1.bestSubset.length})`);
        assert(opt1.bestReward <= 0, `Reward should be 0 or less (got ${opt1.bestReward})`);
        assert(!opt1.discardSubset.includes('p1'), `Should NOT discard p1 as it is not useless (can deliver in stack of 3)`);

        // Scenario B: Carrying 3 parcels. Delivering them is allowed.
        const carried3 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 }
        ];
        const opt3 = optimizeDeliveryStack(beliefs, carried3, 5, 5);
        console.log('Optimizer Output (Case 11 - 3 parcels):', opt3);
        assert(opt3.bestSubset.length === 3, `Should deliver all when carrying 3 parcels (got subset length ${opt3.bestSubset.length})`);
        assert(opt3.bestReward === 30, `Should get reward 30 for 3 parcels (got ${opt3.bestReward})`);

        // Scenario C: Verify CollectAndDeliver generator does not contain putdown
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { CollectAndDeliver } = await import('../src/agent/PlanLibrary.js');
        
        // Mock a simple 2x2 map for A* to succeed
        const tiles = [
            { x: 0, y: 0, type: '3' }, { x: 1, y: 0, type: '3' },
            { x: 0, y: 1, type: '3' }, { x: 1, y: 1, type: '3' }
        ];
        beliefs.map = new MapRepresentation(1, 1, tiles);
        beliefs.me = { x: 0, y: 0 };
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 1, reward: 10 });
        beliefs.blockedTargets = new Map();

        const gen = CollectAndDeliver(beliefs, 'p1');
        const actions = [];
        let res = gen.next();
        while (!res.done) {
            const action = res.value;
            actions.push(action);
            if (action.action === 'move') {
                beliefs.me.x = action.target.x;
                beliefs.me.y = action.target.y;
            }
            res = gen.next(true); // pass true for action success feedback
        }
        console.log('CollectAndDeliver Yielded Actions:', actions);
        
        const hasPutdown = actions.some(a => a.action === 'putdown');
        assert(!hasPutdown, 'CollectAndDeliver plan recipe should NOT contain a direct putdown action');
        
        const pickupAction = actions.find(a => a.action === 'pickup');
        assert(pickupAction !== undefined && pickupAction.target === 'p1', 'CollectAndDeliver should end with the pickup of p1');
    }

    // Case 12: Corridor Blocked by Peer Agent RELAY Contract Proposal
    {
        console.log('--- Testing Case 12: Corridor Blocked by Peer Agent RELAY Contract ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { IntentionEngine } = await import('../src/agent/Intentions.js');

        // Create a 1D grid layout representing a corridor with NO arrows
        // Row 4 will be our corridor: (0,4) to (9,4)
        const tiles = [];
        for (let x = 0; x < 10; x++) {
            for (let y = 0; y < 10; y++) {
                if (y === 4) {
                    if (x === 1) {
                        tiles.push({ x, y, type: '1' }); // Spawn zone at (1,4)
                    } else if (x === 7) {
                        tiles.push({ x, y, type: '2' }); // Delivery zone at (7,4)
                    } else {
                        tiles.push({ x, y, type: '3' }); // Pavement
                    }
                } else {
                    tiles.push({ x, y, type: '0' }); // Wall
                }
            }
        }

        const map = new MapRepresentation(9, 9, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', name: 'Agent BDI', x: 1, y: 4, score: 0 };
        // Peer is in the middle of the corridor at (5,4)
        beliefs.peers = new Map([
            ['agent_2', { id: 'agent_2', name: 'Agent LLM', x: 5, y: 4, score: 0 }]
        ]);
        beliefs.activeContracts = new Map();

        // Mock socket that records proposed contracts
        let proposedContract = null;
        const mockSocket = {
            async emitSay(recipient, message) {
                const parsed = JSON.parse(message);
                if (parsed.type === 'PROPOSE_CONTRACT') {
                    proposedContract = parsed;
                }
            }
        };

        const engine = new IntentionEngine(beliefs, mockSocket);

        // Run the detection
        await engine._checkAndProposeRelayContract();

        assert(proposedContract !== null, 'Should propose a contract due to peer blocking the corridor');
        assert(proposedContract.contractType === 'RELAY', `Contract type should be RELAY (got ${proposedContract.contractType})`);
        // The shared tiles are (1,4) to (4,4) since peer is at (5,4).
        // Best drop tile closest to delivery zone (7,4) is (4,4).
        assert(proposedContract.x === 4 && proposedContract.y === 4, `Drop tile should be (4,4) (got (${proposedContract.x}, ${proposedContract.y}))`);
        assert(proposedContract.courierId === 'agent_1', `Courier should be agent_1 (BDI) since it can reach spawn (got ${proposedContract.courierId})`);
    }

    // Case 13: Non-Blocking Startup Handshake (SYNC_REQ / SYNC_ACK)
    {
        console.log('--- Testing Case 13: Non-Blocking Startup Handshake ---');
        const { IntentionEngine } = await import('../src/agent/Intentions.js');
        const { P2PManager } = await import('../src/communication/P2PCollaboration.js');
        const { AGENT_IDS } = await import('../src/config/config.js');

        const bdiBeliefs = new BeliefBase();
        bdiBeliefs.me = { id: AGENT_IDS.BDI_AGENT_ID, name: 'Agent BDI', x: 0, y: 0 };
        
        let syncReqSent = false;
        let syncAckSent = false;
        
        const bdiSocket = {
            async emitSay(recipient, message) {
                const parsed = JSON.parse(message);
                if (parsed.type === 'SYNC_REQ') {
                    syncReqSent = true;
                    // Simulate routing to peer: Agent 2 receives SYNC_REQ and replies with SYNC_ACK
                    await peerP2P.handleIncomingChat(AGENT_IDS.BDI_AGENT_ID, message);
                }
            }
        };

        const peerSocket = {
            async emitSay(recipient, message) {
                const parsed = JSON.parse(message);
                if (parsed.type === 'SYNC_ACK') {
                    syncAckSent = true;
                    // Simulate routing back to Agent 1
                    await bdiP2P.handleIncomingChat(AGENT_IDS.LLM_AGENT_ID, message);
                }
            }
        };

        const peerBeliefs = new BeliefBase();
        peerBeliefs.me = { id: AGENT_IDS.LLM_AGENT_ID, name: 'Agent LLM', x: 1, y: 1 };

        const bdiP2P = new P2PManager(bdiBeliefs, bdiSocket);
        const peerP2P = new P2PManager(peerBeliefs, peerSocket);

        const bdiEngine = new IntentionEngine(bdiBeliefs, bdiSocket);

        // Initially synced is false
        assert(bdiBeliefs.variables.synced === false, 'Agent should initially not be synchronized');

        // BDI engine tick will run: since not synced, it will emit SYNC_REQ
        await bdiEngine.tick();
        
        assert(syncReqSent === true, 'BDI engine should broadcast SYNC_REQ when not synced');
        assert(syncAckSent === true, 'Peer P2PManager should receive SYNC_REQ and reply with SYNC_ACK');
        assert(bdiBeliefs.variables.synced === true, 'BDI agent should receive SYNC_ACK and transition to synced = true');
    }

    // Case 14: Spawn Tile Clearance — patrol_spawn must NOT target a spawn tile
    {
        console.log('--- Testing Case 14: Spawn Tile Clearance ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { selectBestGoal } = await import('../src/agent/GoalSelector.js');

        // Build a tiny 3×1 corridor:  (0,0)=PAVEMENT  (1,0)=SPAWN  (2,0)=DELIVERY
        const tiles = [
            { x: 0, y: 0, type: '3' },  // PAVEMENT
            { x: 1, y: 0, type: '1' },  // SPAWN
            { x: 2, y: 0, type: '2' },  // DELIVERY
        ];
        const map = new MapRepresentation(2, 0, tiles);  // maxX=2, maxY=0 → width=3, height=1

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', name: 'Agent BDI', x: 0, y: 0, score: 0 };
        beliefs.peers = new Map();
        beliefs.activeContracts = new Map();
        beliefs.variables.synced = true;  // skip sync handshake

        const engineState = {
            dynamicCapacityLimit: 20,
            actionStats: {},
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
        };

        // No parcels — should fall to patrol_spawn
        const goal = selectBestGoal(beliefs, engineState);
        console.log(`Case 14 goal: type=${goal.type}, x=${goal.x}, y=${goal.y}`);

        assert(goal.type === 'patrol_spawn', `Goal type should be patrol_spawn (got ${goal.type})`);
        // The target should be the spawn tile (1,0) directly to encourage patrolling/roaming
        const isSpawnTile = (goal.x === 1 && goal.y === 0);
        assert(isSpawnTile, `patrol_spawn target should be the spawn tile (1,0) — got (${goal.x}, ${goal.y})`);
    }

    // Case 15: Stack-size policy must NOT prevent pickup — agent should collect parcels to build a valid batch
    {
        console.log('--- Testing Case 15: Stack-size policy does not prevent pickup ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { selectBestGoal } = await import('../src/agent/GoalSelector.js');

        // Build a 5×1 corridor: PAVEMENT(0,0) SPAWN(1,0) PAVEMENT(2,0) PAVEMENT(3,0) DELIVERY(4,0)
        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '1' },
            { x: 2, y: 0, type: '3' },
            { x: 3, y: 0, type: '3' },
            { x: 4, y: 0, type: '2' },
        ];
        const map = new MapRepresentation(4, 0, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', name: 'Agent BDI', x: 2, y: 0, score: 0 };
        beliefs.peers = new Map();
        beliefs.activeContracts = new Map();
        beliefs.variables.synced = true;

        // Apply "cannot deliver less than 3 parcels at a time" rule
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Place a visible parcel at the spawn zone
        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 0, reward: 10, carriedBy: null });

        const engineState = {
            dynamicCapacityLimit: 20,
            actionStats: {},
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
        };

        // Scenario A: Empty-handed agent should select pickup (not patrol/patrol_spawn)
        const goalA = selectBestGoal(beliefs, engineState);
        console.log(`Case 15A goal: type=${goalA.type}, targetId=${goalA.targetId}, x=${goalA.x}, y=${goalA.y}`);
        assert(goalA.type === 'pickup', `Empty-handed agent should select pickup (got ${goalA.type})`);
        assert(goalA.targetId === 'p1', `Should target p1 (got ${goalA.targetId})`);

        // Scenario B: Already carrying 1 parcel, should pick up another to build toward 3
        beliefs.me.x = 2;
        beliefs.carried = ['p_carried'];
        beliefs.parcels.set('p_carried', { id: 'p_carried', x: 2, y: 0, reward: 10, carriedBy: 'agent_1' });
        beliefs.parcels.set('p2', { id: 'p2', x: 1, y: 0, reward: 10, carriedBy: null });
        beliefs.parcels.delete('p1');

        const goalB = selectBestGoal(beliefs, engineState);
        console.log(`Case 15B goal: type=${goalB.type}, targetId=${goalB.targetId}, x=${goalB.x}, y=${goalB.y}`);
        assert(goalB.type === 'pickup', `Carrying 1 parcel, agent should pickup more toward stack 3 (got ${goalB.type})`);
        assert(goalB.targetId === 'p2', `Should target p2 (got ${goalB.targetId})`);
    }

    // Case 16: Dead code verification & directional RELAY anchoring
    {
        console.log('--- Testing Case 16: Dead code verification & directional RELAY anchoring ---');
        const policyEngine = await import('../src/policy/PolicyEngine.js');
        assert(policyEngine.executeMissionBehavior === undefined, 'executeMissionBehavior should be removed and undefined');

        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { selectBestGoal } = await import('../src/agent/GoalSelector.js');

        // Corridor map: DELIVERY(0,0) PAVEMENT(1,0) PAVEMENT(2,0)
        const tiles = [
            { x: 0, y: 0, type: '2' }, // Delivery
            { x: 1, y: 0, type: '3' }, // Pavement (drop tile)
            { x: 2, y: 0, type: '3' }, // Pavement (anchor / spawn direction)
        ];
        const map = new MapRepresentation(2, 0, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_2', name: 'Agent LLM', x: 0, y: 0, score: 0 };
        beliefs.peers = new Map();
        
        // Active RELAY contract where agent_2 is receiver and drop tile is (1,0)
        beliefs.activeContracts.set('relay_coop', {
            coopId: 'relay_coop',
            type: 'RELAY',
            x: 1,
            y: 0,
            courierId: 'agent_1',
            status: 'ACTIVE'
        });

        const engineState = {
            dynamicCapacityLimit: 20,
            actionStats: {},
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
        };

        // No parcels on the map yet -> receiver agent should anchor at (0,0) (delivery zone)
        // rather than (2,0) which is in the spawn direction
        const goal = selectBestGoal(beliefs, engineState);
        console.log(`Case 16 goal: type=${goal.type}, targetId=${goal.targetId}, x=${goal.x}, y=${goal.y}`);
        assert(goal.type === 'patrol_spawn', `Idle receiver should anchor (got ${goal.type})`);
        assert(goal.x === 0 && goal.y === 0, `Receiver anchor should be at (0,0) closest to delivery (got (${goal.x},${goal.y}))`);
        console.log('✅ Passed: Receiver anchored successfully towards delivery zone');
    }

    // Case 17: Force hunt/patrol when direct delivery yields <= 0 reward
    {
        console.log('--- Testing Case 17: Force hunt/patrol when delivery yields <= 0 reward ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { selectBestGoal } = await import('../src/agent/GoalSelector.js');

        // Simple map: PAVEMENT(0,0) SPAWN(1,0) DELIVERY(2,0)
        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '1' },
            { x: 2, y: 0, type: '2' },
        ];
        const map = new MapRepresentation(2, 0, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', name: 'Agent BDI', x: 0, y: 0, score: 0 };
        beliefs.peers = new Map();
        beliefs.activeContracts = new Map();
        beliefs.variables.synced = true;

        // Apply "cannot deliver less than 3 parcels at a time" rule
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Carry 1 parcel of reward 12 (not in the map/parcels list to simulate no other pickups)
        beliefs.carried = ['p_carried'];
        beliefs.parcels.set('p_carried', { id: 'p_carried', x: 0, y: 0, reward: 12, carriedBy: 'agent_1' });

        const engineState = {
            dynamicCapacityLimit: 20,
            actionStats: {},
            blockedDeliveryZones: new Map(),
            lastRequiredStackSize: null,
            lastMaxStackSize: null,
        };

        const goal = selectBestGoal(beliefs, engineState);
        console.log(`Case 17 goal: type=${goal.type}, targetId=${goal.targetId}, x=${goal.x}, y=${goal.y}`);

        assert(goal.type === 'patrol_spawn', `Agent should patrol/hunt instead of delivering (got ${goal.type})`);
        assert(goal.x !== 1 || goal.y !== 0, `Target should not be the spawn tile`);
    }

    // Case 18: Pathfinding with blockPeers = true
    {
        console.log('--- Testing Case 18: Pathfinding with blockPeers = true ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { findAStarPath } = await import('../src/mapping/Pathfinding.js');

        // Simple corridor: (0,0) (1,0) (2,0)
        const tiles = [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' },
            { x: 2, y: 0, type: '3' },
        ];
        const map = new MapRepresentation(2, 0, tiles);

        const beliefs = new BeliefBase();
        beliefs.map = map;
        beliefs.me = { id: 'agent_1', x: 0, y: 0 };
        // Teammate peer stands on the middle tile (1,0)
        beliefs.peers.set('agent_2', { id: 'agent_2', x: 1, y: 0 });

        // Standard pathfinding (blockPeers = false) -> path should be found
        const pathNormal = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, null, beliefs, false);
        assert(pathNormal !== null, `Should find path when blockPeers = false`);
        assert(pathNormal.length === 3, `Path length should be 3 steps`);

        // Strict pathfinding (blockPeers = true) -> path should be blocked
        const pathBlocked = findAStarPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, null, beliefs, true);
        assert(pathBlocked === null, `Should NOT find path when blockPeers = true`);
        console.log('✅ Passed: blockPeers correctly blocks pathfinding around other agents');
    }

    // Case 19: Testing DeliveryOptimizer quick check (bypass) when no policy rules are active
    {
        console.log('--- Testing Case 19: DeliveryOptimizer bypass when no policy rules active ---');
        const beliefs = new BeliefBase();
        beliefs.policyRules.rules = [];
        
        const carriedParcels = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 20 },
            { id: 'p3', reward: 30 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carriedParcels, 0, 0);
        assert(opt.bestSubset.length === 3, `Should select all parcels when no policies exist (got ${opt.bestSubset.length})`);
        assert(opt.bestReward === 60, `Should yield direct sum of rewards (got ${opt.bestReward})`);
        assert(opt.bestWaitMs === 0, `Should yield 0 wait time (got ${opt.bestWaitMs})`);
        console.log('✅ Passed: DeliveryOptimizer bypasses optimization and delivers all when rules are empty');
    }

    // Case 20: Testing DeliveryOptimizer adaptive subset selection with 7+ parcels under policy rules
    {
        console.log('--- Testing Case 20: DeliveryOptimizer adaptive subset selection with 7+ parcels ---');
        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 0, y: 0 };
        beliefs.parcelDecayIntervalMs = 0;
        
        // Define policy rule: parcels with reward >= 50 yield 0 reward at delivery zone
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [],
                rewardBounds: [{ min: 50, max: null }],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // We carry 7 parcels: 4 valid (reward 10), 3 forbidden/invalid (reward 50)
        const carriedParcels = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 50 },
            { id: 'p6', reward: 50 },
            { id: 'p7', reward: 50 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carriedParcels, 0, 0);
        
        // Under our new policy-aware adaptive subset generator, the optimal subset should be the 4 valid ones
        assert(opt.bestSubset.length === 4, `Should select exactly the 4 valid parcels (got ${opt.bestSubset.length})`);
        assert(opt.bestReward === 40, `Should yield reward 40 for valid subset (got ${opt.bestReward})`);
        assert(opt.discardSubset.length === 3, `Should identify the 3 invalid/useless parcels to discard (got ${opt.discardSubset.length})`);
        console.log('✅ Passed: DeliveryOptimizer adaptive subset selection correctly filters out invalid parcels with large stacks');
    }

    // Case 21: Policy: cannot deliver less than 4 and more than 5 parcels
    {
        console.log('--- Testing Case 21: Policy "cannot deliver less than 4 and more than 5" ---');
        const { MapRepresentation } = await import('../src/mapping/MapRepresentation.js');
        const { selectBestGoal } = await import('../src/agent/GoalSelector.js');
        const { AGENT_IDS } = await import('../src/config/config.js');

        const beliefs = new BeliefBase();
        beliefs.me = { id: 'agent_1', x: 0, y: 0 };
        
        // Define policy rules:
        // Rule 1: size in [0, 4] -> multiplier 0
        // Rule 2: size in [6, null] -> multiplier 0
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 4 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            },
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 6, max: null }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);
        beliefs.map = new MapRepresentation(10, 10, [
            { x: 0, y: 0, type: '3' },
            { x: 1, y: 0, type: '3' }, // Parcel 1
            { x: 2, y: 0, type: '3' }, // Parcel 2
            { x: 3, y: 0, type: '3' }, // Parcel 3
            { x: 4, y: 0, type: '3' }, // Parcel 4
            { x: 5, y: 0, type: '2' }  // Delivery Zone
        ]);

        beliefs.parcels.set('p1', { id: 'p1', x: 1, y: 0, reward: 20 });
        beliefs.parcels.set('p2', { id: 'p2', x: 2, y: 0, reward: 20 });
        beliefs.parcels.set('p3', { id: 'p3', x: 3, y: 0, reward: 20 });
        beliefs.parcels.set('p4', { id: 'p4', x: 4, y: 0, reward: 20 });

        const engineState = {
            blockedDeliveryZones: new Map(),
            dynamicCapacityLimit: 5,
            actionStats: {
                move: { count: 1, avgTime: 100 },
                pickup: { count: 1, avgTime: 20 },
                putdown: { count: 1, avgTime: 20 }
            }
        };

        // Step 1: Empty-handed. Should target p1
        let goal = selectBestGoal(beliefs, engineState);
        assert(goal.type === 'pickup', `Should target pickup empty-handed (got ${goal.type})`);
        assert(goal.targetId === 'p1', `Should target p1 (got ${goal.targetId})`);

        // Step 2: Carrying p1. Should target p2 (pickup detour)
        beliefs.carried = ['p1'];
        beliefs.me = { id: 'agent_1', x: 1, y: 0 };
        goal = selectBestGoal(beliefs, engineState);
        assert(goal.type === 'pickup', `Should target pickup detour (got ${goal.type})`);
        assert(goal.targetId === 'p2', `Should target p2 detour (got ${goal.targetId})`);

        // Step 3: Carrying p1, p2. Should target p3 (pickup detour)
        beliefs.carried = ['p1', 'p2'];
        beliefs.me = { id: 'agent_1', x: 2, y: 0 };
        goal = selectBestGoal(beliefs, engineState);
        assert(goal.type === 'pickup', `Should target pickup detour (got ${goal.type})`);
        assert(goal.targetId === 'p3', `Should target p3 detour (got ${goal.targetId})`);

        // Step 4: Carrying p1, p2, p3. Should target p4 (pickup detour)
        beliefs.carried = ['p1', 'p2', 'p3'];
        beliefs.me = { id: 'agent_1', x: 3, y: 0 };
        goal = selectBestGoal(beliefs, engineState);
        assert(goal.type === 'pickup', `Should target pickup detour (got ${goal.type})`);
        assert(goal.targetId === 'p4', `Should target p4 detour (got ${goal.targetId})`);

        // Step 5: Carrying p1, p2, p3, p4. Now carrying 4 (valid size). Should deliver!
        beliefs.carried = ['p1', 'p2', 'p3', 'p4'];
        beliefs.me = { id: 'agent_1', x: 4, y: 0 };
        goal = selectBestGoal(beliefs, engineState);
        assert(goal.type === 'deliver', `Should choose to deliver (got ${goal.type})`);
        assert(goal.x === 5, `Should target delivery X coord 5 (got ${goal.x})`);
        assert(goal.y === 0, `Should target delivery Y coord 0 (got ${goal.y})`);

        // Optimizer test: carrying 4, should return all 4 for delivery
        const opt = optimizeDeliveryStack(beliefs, [
            { id: 'p1', reward: 20 },
            { id: 'p2', reward: 20 },
            { id: 'p3', reward: 20 },
            { id: 'p4', reward: 20 }
        ], 5, 0);
        assert(opt.bestSubset.length === 4, `Should select all 4 parcels (got ${opt.bestSubset.length})`);

        // Optimizer test: carrying 7, should return a subset of size 5 for delivery
        const opt7 = optimizeDeliveryStack(beliefs, [
            { id: 'p1', reward: 20 },
            { id: 'p2', reward: 20 },
            { id: 'p3', reward: 20 },
            { id: 'p4', reward: 20 },
            { id: 'p5', reward: 20 },
            { id: 'p6', reward: 20 },
            { id: 'p7', reward: 20 }
        ], 5, 0);
        assert(opt7.bestSubset.length === 5, `Should select exactly 5 parcels for delivery when carrying 7 (got ${opt7.bestSubset.length})`);

        console.log('✅ Passed: Case 21 logic works perfectly and targets correctly under the policy');
    }

    // Case 22: Baseline - No policy -> deliver all at once
    {
        console.log('--- Testing Case 22: Baseline - No policy -> deliver all at once ---');
        const beliefs = new BeliefBase();
        beliefs.policyRules.rules = [];
        
        const carried = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 20 },
            { id: 'p3', reward: 30 }
        ];

        const opt = optimizeDeliveryStack(beliefs, carried, 5, 5);
        assert(opt.bestSubset.length === 3, `Should select all 3 parcels (got ${opt.bestSubset.length})`);
        assert(opt.bestReward === 60, `Should sum rewards directly to 60 (got ${opt.bestReward})`);
    }

    // Case 23: Baseline - Policy "cannot deliver < 3 parcels"
    {
        console.log('--- Testing Case 23: Baseline - Policy "cannot deliver < 3 parcels" ---');
        const beliefs = new BeliefBase();
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // A. Carry 2 parcels -> should return 0 (explore more)
        const carried2 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 }
        ];
        const opt2 = optimizeDeliveryStack(beliefs, carried2, 5, 5);
        assert(opt2.bestSubset.length === 0, `Should not deliver when carrying 2 parcels (got ${opt2.bestSubset.length})`);

        // B. Carry 3 parcels -> should deliver all 3
        const carried3 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 }
        ];
        const opt3 = optimizeDeliveryStack(beliefs, carried3, 5, 5);
        assert(opt3.bestSubset.length === 3, `Should deliver all 3 parcels (got ${opt3.bestSubset.length})`);

        // C. Carry 5 parcels -> should deliver all 5 (since >= 3 is allowed)
        const carried5 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 }
        ];
        const opt5 = optimizeDeliveryStack(beliefs, carried5, 5, 5);
        assert(opt5.bestSubset.length === 5, `Should deliver all 5 parcels (got ${opt5.bestSubset.length})`);
    }

    // Case 24: Baseline - Policy "cannot deliver more than 4 parcels"
    {
        console.log('--- Testing Case 24: Baseline - Policy "cannot deliver more than 4 parcels" ---');
        const beliefs = new BeliefBase();
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 5, max: null }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Carry 5 parcels -> should deliver exactly 4 (leaving 1 to optimize/deliver next)
        const carried5 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 }
        ];
        const opt = optimizeDeliveryStack(beliefs, carried5, 5, 5);
        assert(opt.bestSubset.length === 4, `Should deliver exactly 4 parcels (got ${opt.bestSubset.length})`);
    }

    // Case 25: Baseline - Bounds combination "cannot deliver less than 3 and more than 5"
    {
        console.log('--- Testing Case 25: Baseline - Bounds combination [3, 5] ---');
        const beliefs = new BeliefBase();
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            },
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 6, max: null }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Carry 7 parcels -> should deliver exactly 5 (allowed stack sizes are 3, 4, 5)
        const carried7 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 },
            { id: 'p6', reward: 10 },
            { id: 'p7', reward: 10 }
        ];
        const opt = optimizeDeliveryStack(beliefs, carried7, 5, 5);
        assert(opt.bestSubset.length === 5, `Should deliver exactly 5 parcels (got ${opt.bestSubset.length})`);
    }

    // Case 26: Baseline - Penalty modifiers and "cannot deliver" vs minor penalties
    {
        console.log('--- Testing Case 26: Baseline - Penalty modifiers ---');
        
        // A. Minor penalty: bonus -10, carrying 1 parcel of reward 5.
        // Delivery yields -5 (penalty). No other option yields positive.
        // Since penalty is minor (-5 > -100 under capacity 5), choose the non-empty subset with highest reward.
        {
            const beliefs = new BeliefBase();
            beliefs.config = { GAME: { player: { capacity: 5 } } };
            const rules = [
                {
                    all_tiles: true,
                    tiles: [],
                    stackSizeBounds: [],
                    rewardBounds: [],
                    multiplier: 1,
                    bonus: -10
                }
            ];
            beliefs.applyPolicyRules(rules);

            const carried = [{ id: 'p1', reward: 5 }];
            const opt = optimizeDeliveryStack(beliefs, carried, 5, 5);
            assert(opt.bestSubset.length === 1, `Should deliver under minor penalty (got ${opt.bestSubset.length})`);
            assert(opt.bestReward === -5, `Reward should be -5 (got ${opt.bestReward})`);
        }

        // B. Strict cannot deliver: multiplier 0, carrying 1 parcel of reward 5.
        // Delivery yields 0 reward (multiplier 0). Should NOT deliver, keep exploring (length 0).
        {
            const beliefs = new BeliefBase();
            beliefs.config = { GAME: { player: { capacity: 5 } } };
            const rules = [
                {
                    all_tiles: true,
                    tiles: [],
                    stackSizeBounds: [],
                    rewardBounds: [],
                    multiplier: 0,
                    bonus: null
                }
            ];
            beliefs.applyPolicyRules(rules);

            const carried = [{ id: 'p1', reward: 5 }];
            const opt = optimizeDeliveryStack(beliefs, carried, 5, 5);
            assert(opt.bestSubset.length === 0, `Should NOT deliver under multiplier 0 strict constraint (got ${opt.bestSubset.length})`);
        }

        // C. Strict cannot deliver: high penalty bonus -100, carrying 1 parcel of reward 5.
        // Delivery yields 5 - 100 = -95. Under capacity 5, maxRawRewardOfStack = 100.
        // Penalty bonus -100 is <= -100, so it is a strict cannot deliver rule.
        // Should NOT deliver, keep exploring (length 0).
        {
            const beliefs = new BeliefBase();
            beliefs.config = { GAME: { player: { capacity: 5 } } };
            const rules = [
                {
                    all_tiles: true,
                    tiles: [],
                    stackSizeBounds: [],
                    rewardBounds: [],
                    multiplier: 1,
                    bonus: -100
                }
            ];
            beliefs.applyPolicyRules(rules);

            const carried = [{ id: 'p1', reward: 5 }];
            const opt = optimizeDeliveryStack(beliefs, carried, 5, 5);
            assert(opt.bestSubset.length === 0, `Should NOT deliver under high penalty strict constraint (got ${opt.bestSubset.length})`);
        }
    }

    // Case 27: User Scenario - Policy "cannot deliver < 3", carrying 5, drop 3 (leaving 2), pick up 1 (carrying 3), deliver.
    {
        console.log('--- Testing Case 27: User Scenario - cannot deliver < 3, step-by-step sequence ---');
        const beliefs = new BeliefBase();
        beliefs.config = { GAME: { player: { capacity: 5 } } };
        const rules = [
            {
                all_tiles: true,
                tiles: [],
                stackSizeBounds: [{ min: 0, max: 3 }],
                rewardBounds: [],
                multiplier: 0,
                bonus: null
            }
        ];
        beliefs.applyPolicyRules(rules);

        // Step 1: Carrying 5 parcels. Optimizer should deliver all 5.
        const carried5 = [
            { id: 'p1', reward: 10 },
            { id: 'p2', reward: 10 },
            { id: 'p3', reward: 10 },
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 }
        ];
        const opt5 = optimizeDeliveryStack(beliefs, carried5, 5, 5);
        assert(opt5.bestSubset.length === 5, `Step 1: Should deliver all 5 parcels (got ${opt5.bestSubset.length})`);

        // Step 2: Simulate dropping 3 parcels, leaving 2 in hands.
        // At the delivery tile, optimizer should NOT deliver the remaining 2.
        const carried2 = [
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 }
        ];
        const opt2 = optimizeDeliveryStack(beliefs, carried2, 5, 5);
        assert(opt2.bestSubset.length === 0, `Step 2: Should NOT deliver when carrying 2 parcels (got ${opt2.bestSubset.length})`);

        // Step 3: Traveling to pick up another parcel, crossing a delivery zone carrying 2.
        // Optimizer should still NOT deliver.
        const optCross = optimizeDeliveryStack(beliefs, carried2, 3, 3); // different delivery zone coordinate
        assert(optCross.bestSubset.length === 0, `Step 3: Should NOT deliver when crossing delivery zone carrying 2 (got ${optCross.bestSubset.length})`);

        // Step 4: After picking up the 3rd parcel (now carrying 3).
        // Optimizer should now deliver all 3.
        const carried3 = [
            { id: 'p4', reward: 10 },
            { id: 'p5', reward: 10 },
            { id: 'p6', reward: 10 }
        ];
        const opt3 = optimizeDeliveryStack(beliefs, carried3, 5, 5);
        assert(opt3.bestSubset.length === 3, `Step 4: Should deliver all 3 parcels (got ${opt3.bestSubset.length})`);
    }

    console.log('=== All Unit Tests Passed Successfully ===');
}

runTests().catch(err => {
    console.error('Test run failed with error:', err);
    process.exit(1);
});

