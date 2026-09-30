//! Scripted pilots. The reference pilot flies a sensible, balanced fight; the lazy pilots each
//! do one simple thing. The sanity gate (tests) requires every lazy strategy to lose to the
//! reference pilot: if one doesn't, the rules have a degenerate strategy.
use crate::params::*;
use crate::ship::*;
use crate::world::{Input, World};
use sk_sim::math::{Rng, Vec3};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Style {
    /// The duelist: works at 3–5 km, salvos from range, takes medium-odds shots, punishes
    /// reload windows. (The sanity gate's reference pilot.)
    Reference,
    /// The knife fighter: drives hard to 0.8–1.5 km, where jukes stop working, and fights with
    /// PDC streams, point-blank salvos and sure railgun shots. Pays for it crossing mid range.
    Knife,
    /// The counterpuncher: holds a charge, jukes, and won't shoot first without a near-sure
    /// shot — makes them fire and miss, then punishes the reload.
    Counter,
    /// Striker doctrine: fast slashing merges with tight passes, working at 1.5–3 km — where its
    /// turn rate keeps its gun on target and the other ship's can't.
    Striker,
    /// Warden doctrine: wide passes (~500 m, where its slower turn still keeps the gun on target
    /// and its PDC screen still reaches), salvos from range, working at 2.5–4 km.
    Warden,
    /// Fires every torpedo at once at the start, then drifts.
    Dump,
    /// Keeps its distance, firing torpedoes one at a time; never closes.
    Kite,
    /// Burns directly away from the enemy the whole match.
    Run,
    /// Sits still and lets point defence do the work (fires nothing).
    Turtle,
    /// Charges straight in and fights only with the railgun.
    Brawl,
}

/// The styles meant for the broadcast (the others are lazy negative controls for the gate).
pub const TACTICAL: &[Style] = &[Style::Reference, Style::Knife, Style::Counter];

/// A battle plan: where and when a pilot wants the fight. One pilot brain flies all of them.
#[derive(Clone, Copy, Debug)]
pub struct Doctrine {
    /// The range band it works toward (it closes to the far edge; it never backs off).
    pub home: (f64, f64),
    /// Where it launches salvos (when not behind).
    pub salvo: (f64, f64),
    /// Odds a railgun shot needs, all square (the scoreboard shifts it).
    pub odds: f64,
    /// Burn used to close in (g).
    pub approach_g: f64,
    /// Attacks in slashing passes (boom and zoom): runs in without braking, passes to one side,
    /// coasts out to salvo range and comes round again — instead of parking at close range.
    pub slash: bool,
    /// How wide a slashing pass goes by (m).
    pub pass_by: f64,
    /// Hit and run: make an attack run whenever our gun is ready and theirs isn't (not only
    /// when theirs is down for a while).
    pub runs_on_ready: bool,
    /// The anvil: keep the PDC screen topped up (never grind their hull below this many seconds
    /// of fire while they have torpedoes), and meet an incoming attack run with a salvo.
    pub screen: f64,
}

impl Style {
    pub fn from_name(n: &str) -> Option<Style> {
        Some(match n.to_ascii_lowercase().as_str() {
            "reference" | "duelist" => Style::Reference,
            "knife" => Style::Knife,
            "counter" => Style::Counter,
            "striker" => Style::Striker,
            "warden" => Style::Warden,
            "dump" => Style::Dump,
            "kite" => Style::Kite,
            "run" => Style::Run,
            "turtle" => Style::Turtle,
            "brawl" => Style::Brawl,
            _ => return None,
        })
    }

    pub fn doctrine(self) -> Doctrine {
        match self {
            Style::Knife => Doctrine { home: (800.0, 1500.0), salvo: (4500.0, 7500.0), odds: 0.3, approach_g: 5.0, slash: false, pass_by: 0.0, runs_on_ready: false, screen: 0.0 },
            Style::Striker => Doctrine { home: (1500.0, 3000.0), salvo: (4500.0, 7500.0), odds: 0.3, approach_g: 5.0, slash: true, pass_by: 200.0, runs_on_ready: true, screen: 0.0 },
            Style::Warden => Doctrine { home: (3000.0, 4500.0), salvo: (4000.0, 8000.0), odds: 0.45, approach_g: 3.0, slash: false, pass_by: 0.0, runs_on_ready: false, screen: 15.0 },
            Style::Counter => Doctrine { home: (2500.0, 4200.0), salvo: (4500.0, 7500.0), odds: 0.7, approach_g: 3.0, slash: false, pass_by: 0.0, runs_on_ready: false, screen: 0.0 },
            _ => Doctrine { home: (3000.0, 4200.0), salvo: (4500.0, 7500.0), odds: 0.3, approach_g: 3.0, slash: !std::env::var("SLASH").map_or(false, |v| v == "off"), pass_by: 300.0, runs_on_ready: false, screen: 0.0 },
        }
    }
}

pub struct Pilot {
    pub style: Style,
    /// What the pilot is doing this step (for diagnostics and the broadcast).
    pub mode: &'static str,
    /// Experiment switch: the reference pilot without torpedoes (closes at once).
    pub torps: bool,
    rng: Rng,
    dodge_until: f64,
    dodge_dir: Vec3,
    /// Current juke: direction (world, across the enemy's line of fire) and when to switch.
    pub juke_dir: Vec3,
    juke_until: f64,
    /// Last step's predicted miss, to tell a settling aim from a nose still swinging on.
    last_aim_miss: f64,
    /// Enemy rounds already reacted to.
    seen_flash: Vec<u32>,
    /// In a juke (committed until the threat is clearly over).
    juking: bool,
    /// Odds a shot needs before the gunner takes it (set by posture).
    fire_odds: f64,
    /// Railgun safeties off (set by posture).
    pub overcharge: bool,
    /// Coasting out after a slashing pass.
    extending: bool,
    /// Last time either ship lost hull (to spot a stalled fight), and the hulls then.
    last_change: f64,
    last_health: [f64; 2],
}

impl Pilot {
    pub fn new(style: Style) -> Pilot {
        Pilot::seeded(style, 1)
    }

    pub fn seeded(style: Style, seed: u64) -> Pilot {
        Pilot {
            style,
            mode: "",
            torps: true,
            rng: Rng::new(seed ^ 0x9E37_79B9_7F4A_7C15),
            dodge_until: -1.0,
            dodge_dir: Vec3::ZERO,
            juke_dir: Vec3::ZERO,
            juke_until: -1.0,
            last_aim_miss: f64::MAX,
            seen_flash: Vec::new(),
            juking: false,
            fire_odds: 0.3,
            overcharge: false,
            extending: false,
            last_change: 0.0,
            last_health: [f64::MAX, f64::MAX],
        }
    }

    pub fn act(&mut self, w: &World, me: usize) -> Input {
        let s = &w.ships[me];
        let e = &w.ships[1 - me];
        let mut inp = Input::default();
        if !s.alive {
            return inp;
        }
        let rel = e.pos - s.pos;
        let dist = rel.len();
        let to_enemy = rel.normalized_or(s.forward());
        let closing = -(e.vel - s.vel).dot(to_enemy);
        let aim_at = |dir: Vec3| turn_toward(s, dir);
        match self.style {
            Style::Turtle => {
                inp.rate = aim_at(to_enemy);
            }
            Style::Run => {
                inp.rate = aim_at(-to_enemy);
                inp.thrust_g = 3.0;
            }
            Style::Dump => {
                inp.rate = aim_at(to_enemy);
                inp.fire_torpedo = true;
            }
            Style::Kite => {
                inp.rate = aim_at(to_enemy);
                // Hold 6–8 km: back off if closer, drift in if farther.
                if dist < 6000.0 && closing > -50.0 {
                    inp.rate = aim_at(-to_enemy);
                    inp.thrust_g = 3.0;
                }
                inp.fire_torpedo = w.torps.iter().filter(|t| t.owner == me).count() == 0;
            }
            Style::Brawl => {
                self.mode = "brawl";
                inp.rate = track(s, e);
                if closing < 250.0 || dist > 1500.0 {
                    inp.thrust_g = 4.0;
                }
                self.gun(&mut inp, s, e);
            }
            Style::Reference | Style::Knife | Style::Counter | Style::Striker | Style::Warden => {
                self.reference(w, me, &mut inp);
                inp.overcharge = self.overcharge;
                // PDC fire discipline: keep a reserve sized to their remaining torpedoes (~5 s of
                // fire each) while they could actually get a salvo off at range (torpedoes need
                // ~3.5 km of run-up) or one is inbound; grind their hull only with what's above
                // it. The knife fighter keeps no reserve — it means to win the brawl first.
                let ammo: f64 = s.pdcs.iter().map(|p| p.ammo).sum();
                let could_launch = e.torpedoes > 0 && e.part(Part::Launcher) > 0.0 && (e.pos - s.pos).len() > 3500.0;
                let inbound = w.torps.iter().any(|t| t.alive && t.owner != me);
                let screen = if e.torpedoes > 0 { self.style.doctrine().screen } else { 0.0 };
                let reserve = if self.style == Style::Knife || !(could_launch || inbound) { screen } else { screen.max(5.0 * e.torpedoes as f64) };
                inp.pdc_hold = ammo < reserve;
            }
        }
        inp
    }

    fn reference(&mut self, w: &World, me: usize, inp: &mut Input) {
        let s = &w.ships[me];
        let e = &w.ships[1 - me];
        let rel = e.pos - s.pos;
        let dist = rel.len();
        let to_enemy = rel.normalized_or(s.forward());
        let closing = -(e.vel - s.vel).dot(to_enemy);

        // 1. Torpedo about to hit through a hole in our PDC cover: break hard, whatever it costs.
        let danger = w.torps.iter().filter(|t| t.owner != me && t.alive).any(|t| {
            let r = t.pos - s.pos;
            let tgo = r.len() / (-(t.vel - s.vel).dot(r.normalized_or(Vec3::Z))).max(1.0);
            let covered = (0..PDC_MOUNTS).any(|m| s.part(Part::pdc(m)) > 0.0 && s.pdcs[m].ammo > 0.0 && s.orient.rotate(pdc_normal(m)).dot(r.normalized_or(Vec3::Z)) > PDC_ARC_COS);
            tgo < 2.5 && !covered
        });
        if danger && w.t > self.dodge_until {
            let side = to_enemy.cross(s.vel).normalized_or(to_enemy.any_perp());
            self.dodge_dir = if self.rng.f64() < 0.5 { side } else { -side };
            self.dodge_until = w.t + 1.0;
        }
        if w.t < self.dodge_until {
            self.mode = "torpedo break";
            inp.rate = turn_toward(s, self.dodge_dir);
            // Hard, but within what keeps the crew conscious — unless the ship is already badly
            // hurt and this torpedo would finish it.
            // (Past the crew's limit only if this torpedo would finish the ship.)
            let g = if s.hull < TORP_HULL * 1.2 { 14.0 } else { 12.0f64.min(g_budget(s, 1.0)) };
            inp.thrust_g = if s.forward().dot(self.dodge_dir) > 0.8 { g } else { 0.0 };
            inp.strafe = s.orient.inv_rotate(self.dodge_dir);
            return;
        }

        // 2. Never let the fight get away. The goal is the kill, not survival: if the gap is
        //    growing past torpedo range, turn and go after them.
        let speed = s.vel.len();
        if dist > 9000.0 && closing < 50.0 {
            self.mode = "closing in";
            inp.rate = turn_toward(s, to_enemy);
            inp.thrust_g = if s.forward().dot(to_enemy) > 0.9 { 4.0f64.min(g_budget(s, 5.0)) } else { 0.0 };
            return;
        }
        // Too fast to fight well from outside gun range: bleed it off.
        if speed > 300.0 && dist > 5000.0 && closing > 150.0 {
            self.mode = "braking";
            let want = -(s.vel - e.vel).normalized_or(s.forward());
            inp.rate = turn_toward(s, want);
            inp.thrust_g = if s.forward().dot(want) > 0.9 { 3.0 } else { 0.0 };
            return;
        }

        // 3. The gun duel.
        //
        //    Aiming means pointing the drive along the line of fire, so a ship holding its aim
        //    can only jink on RCS (2 g); a full drive juke gives up the aim. Rounds take ~1 s per
        //    3 km, and a crew sees the flash and reacts: at range a jinking ship is a guess, close
        //    in anything aimed is a sure kill. The whole duel is about initiative and timing:
        //    whose gun is up, who is exposed, and who has just fired and is empty.
        let their_shot = shot(e, s);
        let our_shot = shot(s, e);
        // Posture follows the scoreboard. Behind, gamble: close to where hits are near-certain,
        // take long odds, save the salvo for close range, and past a point accept lethal g.
        // Ahead, protect the lead: hold range, dodge early, take only good shots.
        // (Experiment switch: POSTURE=off flies everyone neutral.)
        let lead_by = if std::env::var("POSTURE").map_or(false, |v| v == "off") { 0.0 } else { s.health_index() - e.health_index() };
        let behind = lead_by < -0.06;
        let desperate = lead_by < -0.15;
        let ahead = lead_by > 0.06;
        let doc = self.style.doctrine();
        self.fire_odds = if behind { (doc.odds - 0.1).max(0.2) } else if ahead { doc.odds + 0.15 } else { doc.odds };
        // The shot clock: a fight where nothing has landed for 15 s is stalled (both waiting on
        // the other). Whoever isn't ahead has the most to gain from action: stop dodging, aim,
        // and take any real chance.
        // (Only damage counts as action. Hull never comes back — repairs fix parts — so any hull
        // lost on either side means something landed.)
        let hulls = [s.hull, e.hull];
        if hulls[0] < self.last_health[0] - 1.0 || hulls[1] < self.last_health[1] - 1.0 {
            self.last_change = w.t;
            self.last_health = hulls;
        }
        let stalled = w.t - self.last_change > 15.0 && w.t > 30.0;
        let commit = stalled && !ahead;
        if commit {
            self.fire_odds = 0.15;
            self.juking = false;
        }
        // Behind: safeties off on the railgun — faster, harder, and it may cook our own gun.
        self.overcharge = lead_by < -0.08 && !std::env::var("OVERCHARGE").map_or(false, |v| v == "off");
        let incoming = w.slugs.iter().any(|sl| sl.owner != me && sl.alive && (s.pos - sl.pos).dot(sl.vel) > 0.0);
        // The flash: their fire control aimed at where our present jink would take us, so
        // reverse it (the drive can't reverse in time — it cuts, by turning away).
        for sl in w.slugs.iter().filter(|sl| sl.owner != me && sl.alive && w.t - sl.born >= FLASH_REACTION) {
            if !self.seen_flash.contains(&sl.id) {
                self.seen_flash.push(sl.id);
                if self.juke_dir != Vec3::ZERO {
                    self.juke_dir = -self.juke_dir;
                    self.juke_until = w.t + 1.2;
                }
            }
        }
        let their_gun_up = e.rail_ammo > 0 && e.part(Part::Railgun) > 0.0 && e.powered() && e.rail_cooldown <= 0.0;
        // Their gun will be ready in (s), if it's coming up at all.
        let their_ready_in = if their_gun_up { e.class.rail_charge * (1.0 - e.rail_charge) } else { f64::MAX };
        // Exposed: their gun (nearly) ready and pointed at us, and a shot now would likely land.
        let exposed = incoming || their_ready_in < 1.2 && their_shot.aim_miss < 60.0 && their_shot.p_env > if ahead { 0.25 } else { 0.35 };
        // Our shot is good enough to take right now, and at least as good as theirs at us.
        let our_move = s.rail_charge >= 1.0 && our_shot.p_hit > self.fire_odds && our_shot.p_hit >= their_shot.p_env - 0.1;
        // A juke only works where a hard sideways burn opens more than the ship's width before
        // the round arrives (after the crew sees the flash). Closer than that it's a gunfight.
        let tr = (dist / RAIL_SPEED - FLASH_REACTION).max(0.0);
        let juke_works = 0.5 * (s.class.rcs_accel + 8.0 * G) * tr * tr > 1.5 * s.class.radius;
        if self.juking && (!their_gun_up && !incoming || our_move || !juke_works) {
            self.juking = false;
        } else if !self.juking && exposed && !our_move && juke_works && !commit {
            self.juking = true;
        }
        if self.juking {
            self.mode = "juke";
            if w.t > self.juke_until || self.juke_dir.dot(to_enemy).abs() > 0.3 {
                self.juke_dir = self.pick_juke(s, e, to_enemy);
                self.juke_until = w.t + self.rng.range(0.5, 1.3);
            }
            inp.rate = turn_toward(s, self.juke_dir);
            // The juice, budgeted: a blackout is ~15 s with nobody flying. Only a ship that's
            // already dying goes past what keeps the crew conscious.
            let want: f64 = if e.rail_charge >= 0.95 || incoming { 11.0 } else { 8.0 };
            let mut g = want.min(g_budget(s, 1.5));
            // The juice past what the crew can take: a ship that's losing badly will kill its own
            // people to live through the next round.
            // Only to save the ship: when their next round would destroy it — not merely to catch
            // up on points.
            let next_hit = e.class.rail_hull * if e.rail_overcharged { RAIL_OVERCHARGE_POWER } else { 1.0 };
            if s.hull < 1.2 * next_hit && (e.rail_charge >= 0.95 || incoming) {
                g = 15.0;
            }
            inp.thrust_g = if s.forward().dot(self.juke_dir) > 0.4 { g } else { 0.0 };
            inp.strafe = s.orient.inv_rotate(self.juke_dir);
            // Time our charge to their capacitors: full just as they must fire or vent (or once
            // they've fired), never so early that ours vents first.
            let their_vent_in = RAIL_HOLD - e.rail_held + e.class.rail_charge * (1.0 - e.rail_charge);
            let ours_needs = s.class.rail_charge * (1.0 - s.rail_charge) + 1.5;
            inp.charge_rail = !their_gun_up || their_vent_in < ours_needs;
            return;
        }

        // 4. Torpedoes: a full salvo from 4.5–7.5 km whenever the tubes are loaded.
        // Variance follows the scoreboard: torpedoes are the high-variance weapon. Behind, fire
        // every salvo the moment it's loaded; ahead, keep them in reserve (a lead wants a quiet
        // fight) unless the shot is nearly free — the enemy's point defence is down.
        let their_pdcs = (0..PDC_MOUNTS).filter(|&m| e.part(Part::pdc(m)) > 0.0 && e.pdcs[m].ammo > 0.0 && !e.pdcs[m].overheated).count();
        let their_ammo: f64 = e.pdcs.iter().map(|p| p.ammo).sum();
        // (Torpedoes need run-up: launched inside ~3.5 km they spend their slow start inside PDC range.)
        // Run-up is only needed to beat point defence: against a ship whose PDCs are dry or down
        // to one mount, send them from anywhere past arming distance.
        let pdcs_thin = their_pdcs <= 1 || their_ammo < 10.0;
        let salvo_range = if pdcs_thin { 800.0..7500.0 } else if behind { 3500.0..7500.0 } else { doc.salvo.0..doc.salvo.1 };
        // The last salvo is the closer: saved for a window — their point defence thinned (mounts
        // lost or hot, ammunition low) or a ship already badly hurt — unless time's running out.
        let last_salvo = s.torpedoes <= s.class.tubes;
        let window = their_pdcs <= 1 || their_ammo < 30.0 || e.health_index() < 0.4 || w.t > 120.0;
        // The anvil meets an attack run with a salvo: the runner is committed to its line.
        let incoming_run = doc.screen > 0.0 && closing > 200.0 && (2500.0..6000.0).contains(&dist);
        let want_salvo = if last_salvo { window || lead_by < -0.2 } else { !ahead || their_pdcs <= 1 || incoming_run };
        let salvo_range = if incoming_run { 2500.0..8000.0 } else { salvo_range };
        if self.torps && want_salvo && salvo_range.contains(&dist) && s.torpedoes > 0 && s.torp_reload <= 0.0 && s.part(Part::Launcher) > 0.0 {
            self.mode = "salvo";
            inp.rate = turn_toward(s, to_enemy);
            inp.fire_torpedo = s.forward().dot(to_enemy) > 0.95;
            return;
        }

        // 5. Aimed: nose on them, gun up, jinking on RCS the whole time (it's free, and it
        //    doubles what they have to guess).
        self.mode = "guns";
        inp.rate = track(s, e);
        self.gun(inp, s, e);
        if dist < 6000.0 {
            if w.t > self.juke_until || self.juke_dir.dot(to_enemy).abs() > 0.3 {
                self.juke_dir = self.pick_juke(s, e, to_enemy);
                self.juke_until = w.t + self.rng.range(0.4, 1.0);
            }
            inp.strafe = s.orient.inv_rotate(self.juke_dir);
        }
        // Range: hold where an aimed, jinking ship is still a guess (~3–4 km) while their gun
        // is up; when they've fired or vented and are empty for a while, go in for the sure one.
        // Holding the last salvo with the finishing window open: extend to launch range first.
        let holding_closer = s.torpedoes > 0 && s.torpedoes <= s.class.tubes && s.part(Part::Launcher) > 0.0 && (e.health_index() < 0.4 || e.pdcs.iter().map(|p| p.ammo).sum::<f64>() < 30.0);
        // Slashing passes: after the merge, coast out (gun still tracking) to salvo range, then
        // come round again.
        if doc.slash {
            if !self.extending && dist < 2500.0 && closing < -50.0 {
                self.extending = true;
            } else if self.extending && (dist > if holding_closer { 6200.0 } else { doc.home.1 + 700.0 } || closing > -30.0) {
                self.extending = false;
            }
        }
        if doc.slash && self.extending {
            self.mode = "extend";
            inp.thrust_g = 0.0;
            return;
        }
        let their_down_for = if their_gun_up { their_ready_in } else { e.rail_cooldown + e.class.rail_charge * (1.0 - e.rail_charge) };
        let ours_ready_in = s.class.rail_charge * (1.0 - s.rail_charge) + s.rail_cooldown;
        let run_now = doc.runs_on_ready && s.rail_charge >= 0.8 && their_down_for > 1.0 && dist > 800.0;
        if run_now || their_down_for > ours_ready_in + 1.5 || e.rail_ammo == 0 || e.part(Part::Railgun) <= 0.0 || !e.powered() {
            self.mode = "punish";
            if doc.slash {
                // An attack run: straight through the merge at speed (the pass offset is set on
                // RCS below), shooting from inside their turn, then out the other side.
                self.mode = "attack run";
                if dist > 250.0 && closing < 450.0 {
                    inp.thrust_g = 6.0f64.min(g_budget(s, 3.0));
                }
            } else if dist > 1200.0 && closing < 400.0 {
                inp.thrust_g = 6.0f64.min(g_budget(s, 3.0));
            }
        } else if dist > doc.home.1 + if ahead { 600.0 } else { 0.0 } && closing < 150.0 + 100.0 * (doc.approach_g - 3.0) {
            // Work in to the doctrine's range.
            inp.thrust_g = doc.approach_g.min(g_budget(s, 3.0));
        } else if !ahead && dist > doc.home.0 && closing < 50.0 {
            // In the band with their gun up: work in steadily, never away.
            inp.thrust_g = 1.5;
        }
        // Collision avoidance: if we're on course to pass within a ship's length or two in the
        // next few seconds, sidestep off the collision line (it's a jink anyway).
        let rv = e.vel - s.vel;
        let tca = (-rel.dot(rv) / rv.len_sq().max(1e-6)).clamp(0.0, 8.0);
        let miss = rel + rv * tca;
        // A slasher offsets its run on purpose to pass ~300 m to one side.
        let pass_by = if doc.slash { doc.pass_by } else { 3.0 * (s.class.radius + e.class.radius) };
        if tca > 0.0 && tca < 8.0 && miss.len() < pass_by {
            // `miss` is where they'll be relative to us at closest approach: step the other way.
            let away = (-miss).normalized_or(to_enemy.any_perp());
            let side = (away - to_enemy * away.dot(to_enemy)).normalized_or(to_enemy.any_perp());
            inp.strafe = s.orient.inv_rotate(side);
            if tca < 4.0 && !doc.slash {
                inp.thrust_g = 0.0;
            }
        } else if doc.slash && tca > 0.0 && tca < 8.0 && miss.len() > 1.5 * pass_by && miss.len() > 2.0 * (s.class.radius + e.class.radius) {
            // Passing wider than we want: cut in (a Striker cuts inside a Warden's turn; the
            // Warden steps out to keep the pass wide enough for its gun to track).
            let toward = miss.normalized_or(to_enemy.any_perp());
            let side = (toward - to_enemy * toward.dot(to_enemy)).normalized_or(to_enemy.any_perp());
            inp.strafe = s.orient.inv_rotate(side);
        }
        // Don't overrun them: keep the closing speed to what the RCS (2 g, keeping the aim)
        // can still stop short of the stand-off. Ramming kills both ships.
        // Only our own approach counts: if they're the ones charging in, braking would just
        // spend the RCS we need for jinking.
        let stand_off = (doc.home.0 * 0.7).max(500.0);
        let v_max = (2.0 * s.class.rcs_accel * (dist - stand_off).max(0.0)).sqrt();
        let our_approach = (s.vel - (s.vel + e.vel) * 0.5).dot(to_enemy);
        if !doc.slash && closing > v_max && our_approach > 0.5 * closing {
            inp.thrust_g = 0.0;
            inp.strafe = s.orient.inv_rotate(-to_enemy) + inp.strafe * 0.3;
        }
    }

    fn pick_juke(&mut self, s: &Ship, e: &Ship, los: Vec3) -> Vec3 {
        // A random direction across their line of fire, preferring ones near where the nose
        // already points (less turning) and away from the edge of the fight.
        // Strongly prefer the side the nose already faces: the drive can push that way at once.
        let mut best = (f64::MIN, Vec3::ZERO);
        for _ in 0..8 {
            let v = self.rng.unit_vec();
            let d = (v - los * v.dot(los)).normalized_or(los.any_perp());
            let mut score = 2.0 * s.forward().dot(d) + self.rng.f64();
            // Jukes that also bleed off sideways speed built up by earlier ones.
            let drift = s.vel - e.vel;
            score -= d.dot(drift - los * drift.dot(los)) / 150.0;
            if score > best.0 {
                best = (score, d);
            }
        }
        best.1
    }
}

pub struct Shot {
    /// Miss distance if fired now against the target's present motion (m).
    pub aim_miss: f64,
    /// How far the target could be from that prediction by the time the round arrives, if it
    /// used everything it has sideways (m).
    pub escape: f64,
    /// Chance of a hit: the ship's size against the area it could be in.
    pub p_hit: f64,
    /// The same, if the aim were perfect (how exposed the target is, whatever the aim).
    pub p_env: f64,
}

/// A railgun shot from `s` at `e` as fire control sees it.
pub fn shot(s: &Ship, e: &Ship) -> Shot {
    let rel = e.pos - s.pos;
    let t = intercept_time(s, e, RAIL_SPEED);
    let future = rel + (e.vel - s.vel) * t + e.accel_avg * (0.5 * t * t);
    let along = future.dot(s.forward());
    let aim_miss = if along > 0.0 { (future - s.forward() * along).len() } else { f64::MAX };
    // How far the target can get from the prediction once it sees the flash (after the reaction
    // time): its RCS jink can reverse (+a to -a); its drive only pushes forward and can't turn
    // round in time, so a sideways burn already lit can only be cut (a to 0).
    // After the flash the target can put any sideways RCS push up to RCS_ACCEL on, instead of
    // whatever it's doing now (which fire control assumed would continue): a jink already on
    // can be reversed, doubling the change. A sideways drive burn can only be cut.
    let los = rel.normalized_or(s.forward());
    let lat = |v: Vec3| v - los * v.dot(los);
    let f = e.forward();
    let rcs = e.class.rcs_accel;
    let drive = f * e.accel.dot(f).max(0.0).min(if e.accel.dot(f) > rcs * 1.5 { f64::MAX } else { 0.0 });
    // (What the prediction leaves out: the jink on right now, over and above the average.)
    let rcs_now = lat(e.accel - e.accel_avg - drive).len().min(rcs);
    let tr = (t - FLASH_REACTION).max(0.0);
    let escape = 0.5 * (rcs + rcs_now + lat(drive).len()) * tr * tr;
    let radius = e.class.radius;
    let p_env = (radius / escape.max(radius)).powi(2);
    // Aim error eats into the target: what's left of the ship's width against the envelope.
    let r_eff = (radius - aim_miss).max(0.0);
    let p_hit = if r_eff <= 0.0 { 0.0 } else { (r_eff / escape.max(r_eff)).powi(2) };
    Shot { aim_miss, escape, p_hit, p_env }
}

impl Pilot {
    /// Charge the railgun when the target is near the nose and exposed; fire when a hit is
    /// likely and the aim has settled (well inside the hull, or no longer improving).
    fn gun(&mut self, inp: &mut Input, s: &Ship, e: &Ship) {
        let err = s.forward().dot(lead(s, e, RAIL_SPEED));
        let sh = shot(s, e);
        inp.charge_rail = err > 0.9 && sh.p_env > 0.15;
        let settled = sh.aim_miss < e.class.radius * 0.35 || sh.aim_miss >= self.last_aim_miss;
        // With the capacitors about to vent, take whatever chance there is.
        // (A counterpuncher would rather vent than give away a poor first shot.)
        let use_it = s.rail_held > RAIL_HOLD - 0.4 && sh.p_hit > if self.style == Style::Counter { self.fire_odds } else { 0.05 };
        inp.fire_rail = (sh.p_hit > self.fire_odds && settled) || use_it;
        self.last_aim_miss = sh.aim_miss;
    }
}

/// Highest drive g the crew can take for `horizon` seconds and all stay conscious, with a
/// margin under the blackout dose. Felt g includes the RCS jink on top of the drive.
pub fn g_budget(s: &Ship, horizon: f64) -> f64 {
    let mut felt = DRIVE_MAX_G;
    for c in s.crew.iter().filter(|c| c.working()) {
        let room = (0.7 * BLACKOUT * c.tolerance - c.dose).max(0.0);
        let rate = room / horizon + DOSE_RECOVER;
        felt = felt.min(4.0 * (rate / DOSE_K).powf(0.25));
    }
    // Worst case the RCS push lines up with the drive.
    (felt - s.class.rcs_accel / G).max(2.0)
}

/// Time for a round of speed `speed` to meet the target on its present motion (velocity and
/// acceleration), solved by fixed-point iteration.
pub fn intercept_time(s: &Ship, e: &Ship, speed: f64) -> f64 {
    let (rel, rv) = (e.pos - s.pos, e.vel - s.vel);
    let mut t = rel.len() / speed;
    for _ in 0..4 {
        t = (rel + rv * t + e.accel_avg * (0.5 * t * t)).len() / speed;
    }
    t
}

/// Direction to aim a round of speed `speed` to meet the target on its present motion.
pub fn lead(s: &Ship, e: &Ship, speed: f64) -> Vec3 {
    // The round keeps the ship's velocity but not its acceleration; the target keeps both.
    let t = intercept_time(s, e, speed);
    (e.pos - s.pos + (e.vel - s.vel) * t + e.accel_avg * (0.5 * t * t)).normalized_or(s.forward())
}

/// Hold the nose on the railgun solution against a moving target: turn toward the lead point,
/// plus the line of sight's own turn rate (so the nose keeps up instead of trailing it).
pub fn track(s: &Ship, e: &Ship) -> Vec3 {
    let rel = e.pos - s.pos;
    let u = rel.normalized_or(s.forward());
    let rv = e.vel - s.vel;
    let los_rate = u.cross((rv - u * u.dot(rv)) / rel.len().max(1.0));
    let ff = s.orient.inv_rotate(los_rate);
    let v = turn_toward(s, lead(s, e, RAIL_SPEED)) + ff;
    let m = s.class.max_rate;
    Vec3::new(v.x.clamp(-m, m), v.y.clamp(-m, m), v.z.clamp(-m, m))
}

/// Body rates that turn the nose toward `dir` (proportional, clamped by the ship's limits).
pub fn turn_toward(s: &Ship, dir: Vec3) -> Vec3 {
    let d = s.orient.inv_rotate(dir.normalized_or(s.forward()));
    // Rotation axis from nose (Z) to d, scaled by the angle between them.
    let axis = Vec3::Z.cross(d);
    let ang = Vec3::Z.dot(d).clamp(-1.0, 1.0).acos();
    let axis = if axis.len() < 1e-6 { if ang > 1.0 { Vec3::Y } else { Vec3::ZERO } } else { axis.normalized() };
    // Time-optimal: as fast as the ship can still brake to a stop in the angle left
    // (ω = √(2αθ), with a margin), capped at its turn rate. A fixed proportional gain lags a
    // moving target by a degree or so, which is tens of metres at gun range.
    let alpha = s.class.rot_accel;
    let rate = (0.7 * (2.0 * alpha * ang).sqrt()).max(2.5 * ang).min(s.class.max_rate);
    axis * rate
}
