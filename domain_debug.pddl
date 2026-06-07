(define (domain deliveroo-crates)
    (:requirements :strips)
    (:predicates
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
            (me ?me)
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
            (me ?me)
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
            (me ?me)
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
            (me ?me)
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