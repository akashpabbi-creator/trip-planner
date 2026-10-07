# Brief: publish the new Firestore rules for the trip planner

You are a Claude desktop/Cowork session with a browser. Do this one task, then report back. It takes about two minutes.

## What and why

The trip planner (a static web app) has a new feature, **Connect Claude**, that stores a small private document per trip in a new Firestore collection `bridges`. Firestore blocks it until the project's security rules allow it. The rules below are the existing trip rules **unchanged**, plus one new `match /bridges/{token}` block at the end. Publishing them is the only thing you need to do. Do not change anything else in the project.

- Firebase project: **`our-trips-ab49a`** (Firestore database `(default)`)
- Who: the owner's Google account (the one that owns the Firebase project) must be signed in in the browser. If it isn't, stop and ask the user to sign in; never ask for or type a password yourself.

## Steps

1. Open https://console.firebase.google.com/project/our-trips-ab49a/firestore/databases/-default-/rules (or: console.firebase.google.com, choose the project `our-trips-ab49a`, then **Build, Firestore Database, Rules**).
2. Click into the rules editor, select everything (Ctrl/Cmd+A) and delete it.
3. Paste exactly this, and nothing else:

```
rules_version = '2';
// Only people listed in a trip's "members" can read or change it.
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null && request.auth.token.email_verified == true; }
    function me() { return request.auth.token.email.lower(); }
    function isMember(tripId) {
      return me() in get(/databases/$(database)/documents/trips/$(tripId)).data.members;
    }

    match /trips/{tripId} {
      allow read: if signedIn() && me() in resource.data.members;
      allow create: if signedIn() && request.resource.data.owner == me()
                    && request.resource.data.members == [me()];
      // Members can edit the trip and invite people, but can't remove the owner.
      allow update: if signedIn() && me() in resource.data.members
                    && request.resource.data.owner == resource.data.owner
                    && resource.data.owner in request.resource.data.members;
      allow delete: if signedIn() && me() == resource.data.owner;

      match /{sub}/{docId} {
        allow read, write: if signedIn() && sub in ['items', 'activity', 'presence'] && isMember(tripId);
      }
    }

    // Claude link. The doc id is a secret token: anyone who has it can read the doc, nobody can list them.
    // Signed-in members of the trip manage it. Claude has no sign-in, so without one it may only add to the inbox
    // (and stamp inboxAt): the plan snapshot and everything else stays untouchable.
    match /bridges/{token} {
      allow get: if true;
      allow create: if signedIn() && request.resource.data.tripId is string && isMember(request.resource.data.tripId);
      allow update: if (signedIn() && isMember(resource.data.tripId)
                        && request.resource.data.tripId == resource.data.tripId)
                    || (resource.data.on == true
                        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['inbox', 'inboxAt'])
                        && request.resource.data.inbox is list
                        && request.resource.data.inbox.size() <= 30);
      allow delete: if signedIn() && isMember(resource.data.tripId);
    }
  }
}
```

4. Click **Publish**. Wait for "Rules published" (or for the editor's "Published" timestamp to update). If the editor shows a red error marker, don't publish: fix a copy/paste slip (the text above is complete and valid) and try again.
5. Check it took effect: reload the Rules page and confirm the editor shows the `match /bridges/{token}` block and a fresh publish time.

## Optional check (if you have a shell)

Replace `TOKEN` with any 32 characters; a missing document is fine, it proves the rules are live:

```
curl -s -o /dev/null -w "%{http_code}\n" "https://firestore.googleapis.com/v1/projects/our-trips-ab49a/databases/(default)/documents/bridges/TOKEN?key=AIzaSyDrEN_jDzHweWVPzBT8ZZVR1Jhey87ZnHE"
```

- `404`: the rules are live (not found, but allowed to ask). 
- `403`: the old rules are still active; publish again.

And that listing is still blocked (expect `403`):

```
curl -s -o /dev/null -w "%{http_code}\n" "https://firestore.googleapis.com/v1/projects/our-trips-ab49a/databases/(default)/documents/bridges?key=AIzaSyDrEN_jDzHweWVPzBT8ZZVR1Jhey87ZnHE"
```

## What the new block allows (so you can explain it to the user)

- Anyone who knows a link's secret token can read that one document. Nobody can list the collection.
- Signed-in members of the trip create, change and delete their trip's link document.
- A Claude session, without signing in, may only append to the `inbox` (up to 30 entries) and stamp `inboxAt`. It cannot read or change the plan snapshot, the trip id or anything else, and it cannot delete the document.
- Trips, items, activity and presence rules are exactly as before.

## Report back

Say whether it published, the publish time shown, and the results of the two optional checks if you ran them. If anything looked different from the above (a different existing rules text in the editor before you replaced it), paste the old text into your report so it isn't lost.
