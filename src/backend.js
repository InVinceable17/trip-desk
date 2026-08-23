/* The storage backend. `build.mjs` leaves this pointing at the artifact;
   `build-web.mjs` swaps it for Firestore. Both export the same three things:
   `loadAll`, `makeSaver`, and `auth`. */
export * from "./store-artifact.js";
