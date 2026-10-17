# Trabajo en paralelo

Tres trabajos a la vez, cada uno en su worktree y con su sesión de
Claude Code. El aislamiento lo da Git; el reparto lo decido aquí,
antes de abrir las sesiones.

## Los tres worktrees

| Worktree | Rama | Archivos que le pertenecen |
|--|--|--|
| `../paralelo/landing` | `trabajo/landing` | landing/ |
| `../paralelo/catalogo` | `trabajo/catalogo` | paquetes/catalogo-mcp/ |
| `../paralelo/docs` | `trabajo/docs` | docs/, salvo este archivo |

Ningún trabajo toca archivos de otro. Si necesita un cambio ajeno,
lo anota en «Pedidos entre trabajos» y no lo hace.

## Decisiones compartidas, tomadas antes

- Dirección de envíos: `convocatoria@example.invalid` (sintética).
  La escribe `landing` en el pie; `docs` la copia en las bases.

## Orden de fusión

1. `trabajo/landing`: dueño de lo que se ve.
2. `trabajo/catalogo`.
3. `trabajo/docs`: cita lo que dejaron los otros dos.

Se fusiona en una rama de integración (`lab/c20`) y, con
`npm test` en verde, en `main`.

## Comandos

    git switch -c lab/c20
    for t in landing catalogo docs; do
      git worktree add -b trabajo/$t ../paralelo/$t
    done
    git worktree list
    # en cada worktree: npm ci y una sesión, claude -n <trabajo>
    for t in landing catalogo docs; do
      git merge --no-edit trabajo/$t || break
    done
    for t in landing catalogo docs; do
      git worktree remove ../paralelo/$t
      git branch -d trabajo/$t
    done

## Cuándo no

- Dos trabajos tocan el mismo archivo: una sola sesión, o en serie.
- Uno necesita el resultado del otro: en serie.
- El trabajo cabe en una sesión: tres sesiones gastan la cuota tres
  veces, cada una por su lado.

## Pedidos entre trabajos

- (ninguno esta semana)
