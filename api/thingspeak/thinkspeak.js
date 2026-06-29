import admin from "firebase-admin";


if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_ADMIN_KEY)
    )
  });
}


const db = admin.firestore();


export default async function handler(req, res) {

  const {
    channelId,
    fieldId,
    days = 1
  } = req.query;


  try {

    // Find channel securely
    const snapshot = await db
      .collection("coops")
      .where("ID", "==", channelId)
      .limit(1)
      .get();


    if (snapshot.empty) {
      return res.status(404).json({
        error:"Channel not found"
      });
    }


    const channel = snapshot.docs[0].data();


    const apiKey = channel.ReadAPI;


    const url = new URL(
      `https://api.thingspeak.com/channels/${channelId}/fields/${fieldId}.json`
    );


    url.searchParams.append(
      "days",
      days
    );


    url.searchParams.append(
      "api_key",
      apiKey
    );


    const response = await fetch(url);


    const data = await response.json();


    res.status(200).json(data);


  } catch(error){

    console.error(error);

    res.status(500).json({
      error:"Server error"
    });

  }

}