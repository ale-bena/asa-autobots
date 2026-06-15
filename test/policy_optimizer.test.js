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
        // The target should NOT be the spawn tile (1,0)
        const isSpawnTile = (goal.x === 1 && goal.y === 0);
        assert(!isSpawnTile, `patrol_spawn target should NOT be the spawn tile (1,0) — got (${goal.x}, ${goal.y})`);
        // The target should be one of the non-spawn adjacent tiles: (0,0) pavement or (2,0) delivery
        const isValidAdjacentTile = (goal.x === 0 && goal.y === 0) || (goal.x === 2 && goal.y === 0);
        assert(isValidAdjacentTile, `patrol_spawn target should be an adjacent non-spawn tile — got (${goal.x}, ${goal.y})`);
        // Verify the target tile is not a spawn tile on the map
        const targetTileCode = map.getTileCode(goal.x, goal.y);
        assert(targetTileCode !== MapRepresentation.TILE_CODES.SPAWN, `patrol_spawn target tile code should NOT be SPAWN — got code ${targetTileCode}`);
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

    console.log('=== All Unit Tests Passed Successfully ===');
}

runTests().catch(err => {
    console.error('Test run failed with error:', err);
    process.exit(1);
});

