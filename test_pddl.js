import { onlineSolver } from '@unitn-asa/pddl-client';

const domainPddl = `
(define (domain deliveroo-crates)
    (:requirements :strips :typing)
    (:predicates
        (tile ?t)
        (agent ?a)
        (crate ?c)
        (me ?a)
        (at ?obj ?t)
        (crate-move-capable ?t)
        (clear ?t)
        (right ?t1 ?t2)
        (left ?t1 ?t2)
        (up ?t1 ?t2)
        (down ?t1 ?t2)
    )

    (:action move-right
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (right ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-left
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (left ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-up
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (up ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action move-down
        :parameters (?me ?from ?to)
        :precondition (and (me ?me) (at ?me ?from) (down ?from ?to) (clear ?to))
        :effect (and (at ?me ?to) (not (at ?me ?from)))
    )

    (:action push-right
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (right ?myPos ?cratePos) (right ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-left
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (left ?myPos ?cratePos) (left ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-up
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (up ?myPos ?cratePos) (up ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )

    (:action push-down
        :parameters (?me ?crate ?myPos ?cratePos ?destPos)
        :precondition (and
            (me ?me) (crate ?crate)
            (at ?me ?myPos) (at ?crate ?cratePos)
            (crate-move-capable ?destPos)
            (clear ?destPos)
            (down ?myPos ?cratePos) (down ?cratePos ?destPos)
        )
        :effect (and
            (at ?me ?cratePos) (not (at ?me ?myPos))
            (at ?crate ?destPos) (not (at ?crate ?cratePos))
            (clear ?cratePos) (not (clear ?destPos))
        )
    )
)
`;

const problemPddl = `
(define (problem crate-push-problem)
    (:domain deliveroo-crates)
    (:objects
        ag - agent
        crate_target - crate
        t_0_0 t_0_1 t_0_2 t_1_0 t_1_1 t_1_2 - tile
    )
    (:init
        (tile t_0_0) (tile t_0_1) (tile t_0_2)
        (tile t_1_0) (tile t_1_1) (tile t_1_2)
        (crate-move-capable t_0_0) (crate-move-capable t_0_1) (crate-move-capable t_0_2)
        (crate-move-capable t_1_0) (crate-move-capable t_1_1) (crate-move-capable t_1_2)
        (up t_0_0 t_0_1) (down t_0_1 t_0_0)
        (up t_0_1 t_0_2) (down t_0_2 t_0_1)
        (up t_1_0 t_1_1) (down t_1_1 t_1_0)
        (up t_1_2 t_1_1) (down t_1_1 t_1_2)
        (right t_0_0 t_1_0) (left t_1_0 t_0_0)
        (right t_0_1 t_1_1) (left t_1_1 t_0_1)
        (right t_0_2 t_1_2) (left t_1_2 t_0_2)
        (agent ag)
        (me ag)
        (at ag t_0_0)
        (crate crate_target)
        (at crate_target t_0_1)
        (clear t_0_0)
        (clear t_0_2)
        (clear t_1_0)
        (clear t_1_1)
        (clear t_1_2)
    )
    (:goal (at crate_target t_0_2))
)
`;

console.log("Submitting test problem to online solver...");
try {
    const rawPlan = await onlineSolver(domainPddl, problemPddl);
    console.log("Plan result:", rawPlan);
} catch (e) {
    console.error("Solver error:", e);
}
