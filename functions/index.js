//   Toulouse Transport, action for the Google Assistant
//   Copyright (C) 2018  Quentin LAMBERT
//
//   This program is free software: you can redistribute it and/or modify
//   it under the terms of the GNU Affero General Public License as published
//   by the Free Software Foundation, either version 3 of the License, or
//   (at your option) any later version.
//
//   This program is distributed in the hope that it will be useful,
//   but WITHOUT ANY WARRANTY; without even the implied warranty of
//   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   GNU Affero General Public License for more details.
//
//   You should have received a copy of the GNU Affero General Public License
//   along with this program.  If not, see <https://www.gnu.org/licenses/>.

'use strict';

// Path to the Tisseo API used by the request getting stops schedules, @see https://data.toulouse-metropole.fr/explore/dataset/api-temps-reel-tisseo/information/
const stopsSchedulesTisseoApiPath = '/v1/stops_schedules.json?timetableByArea=1&maxDays=1&number=3&key=<TISSEO_API_KEY>&stopAreaId=';

// Import the Dialogflow module from the Actions on Google client library.
const { dialogflow } = require('actions-on-google');

// Import the firebase-functions package for deployment.
const functions = require('firebase-functions');

const http = require('https');



const app = dialogflow({ debug: true });  // // Instantiate the Dialogflow client.

const strSpeechError = 'Aucun passage de transport en commun n\'a été trouvé. N\'hésitez pas à réessayer.';


var httpOptions = {
	host: 'api.tisseo.fr',
	path: ''
};

const TimeUnit = { SECOND: 'seconde', MINUTE: 'minute', HOUR: '' };
Object.freeze(TimeUnit);

/**
 * Handle the Dialogflow intent named 'StopsSchedules'.
 *
 * @param {Object} conv : dialogflow conversation object
 * @param {String} stopId : identifier of the logical stop point where the user want to take public transit
 * @param {String} destinationId : (optional) identifier of the logical stop point where the user want to go, or an empty string if is not set
 */
app.intent('StopsSchedules', (conv, {stopId, destinationId}) => {
	httpOptions.path = stopsSchedulesTisseoApiPath + stopId;

	// return a promise to handle this intent asynchronously
	return new Promise(function (resolve, reject) {
		let chunks = [];
		http.get(httpOptions, function (resp) {
			resp
				.on('data', function (chunk) {
					chunks.push(chunk);
				})
				.on('end', function () {
					let parsedData;
					let data;
					let schedules;
					let waitingTimesByDestination = [];
					let destinationIdToDestinationName = [];
					data = Buffer.concat(chunks);

					parsedData = JSON.parse(data);

					//console.log('parsedData: '+parsedData);
					if (schedules = parsedData['departures']['stopAreas'].length > 0) {
						// Parse JSON data to fill waitingTimesByDestination
						schedules = parsedData['departures']['stopAreas'][0]['schedules'];
						for (var iSchedule = 0; iSchedule < schedules.length; iSchedule++) {
							let schedule = schedules[iSchedule];
							let strDestinationName = schedule['destination'].name;
							destinationIdToDestinationName[schedule.destination.id] = strDestinationName;
							waitingTimesByDestination[strDestinationName] = [];

							for (var iJourney = 0; iJourney < schedule['journeys'].length; iJourney++) {
								waitingTimesByDestination[strDestinationName].push(schedule['journeys'][iJourney].waiting_time);
							}
						}

						let strSpeech = '<speak>';
						let strUserDestinationName = '';
						let strCurrentStopName = parsedData['departures']['stopAreas'][0]['name'];

						if (destinationId.length > 0) {
							// destinationId is set, so the user has told the destination parameter
							if (destinationId in destinationIdToDestinationName) {
								// destinationId is in the list of destination available at this stop
								strUserDestinationName = destinationIdToDestinationName[destinationId];
								strSpeech += 'Les prochains passages à l\'arrêt ' + strCurrentStopName + ' en direction de ' + strUserDestinationName + ' sont dans ';
								strSpeech += waitingTimeToString(waitingTimesByDestination[strUserDestinationName]) + '. ';
							}
							else {
								// destinationId is NOT in the list of destination available at this stop
								strSpeech += 'Je n\'ai pas saisi la destination, mais ';
							}
						}

						// if destinationName is not set, tell all destinations available at this stop
						if (strUserDestinationName === '') {
							let strDestinationIntroduction = '';
							let numDestinations = Object.keys(waitingTimesByDestination).length;
							if (numDestinations > 2) {
								strDestinationIntroduction = ' en fonctions des ' + numDestinations + ' différentes déstinations';
							}

							strSpeech += 'Voici les prochains passages à l\'arrêt ' + strCurrentStopName + strDestinationIntroduction + '. ';

							let strHelperIntroduction = 'les prochains passages sont '
							for (let destination in waitingTimesByDestination) {
								strSpeech += 'En direction de ' + destination + ', ' + strHelperIntroduction + 'dans ' + waitingTimeToString(waitingTimesByDestination[destination]) + '. ';
								strHelperIntroduction = '';  // told only the first occurence
							}
						}

						// Ending
						strSpeech += '<break time="0.5s"/>A bientôt.</speak>';

						conv.close(strSpeech);
					}
					else {
						// No one stopArea in JSON data received from Tisseo API 
						conv.close(strSpeechError);
					}
					resolve();
				});

		}).on("error", function (e) {
			conv.close(strSpeechError);
			reject(e);
		});
	});

});

// Set the DialogflowApp object to handle the HTTPS POST request.
exports.dialogflowFirebaseFulfillment = functions.https.onRequest(app);



/**
 * Convert a time string under "hh:mm:ss" format to a human listenable short time.
 * Below are some examples of conversions:
 * 	"00:00:37" => {37, TimeUnit.SECOND}
 * 	"00:02:30" => {2, TimeUnit.MINUTE}
 * 	"01:05:30" => {'une heure 5 minutes', TimeUnit.HOUR}
 * 	"02:05:30" => {'dans plus de 2 heures', TimeUnit.HOUR}
 *
 * @param {String} timeString : time string under the "hh:mm:ss" format
 * @return {Object} .value : String containing a short time ; .timeUnit : value from TimeUnit enumeration of the greatest time unit present in .value
 */
function timeToShortTime(timeString) {
	let result = [];

	let timeByUnit = timeString.split(':');

	let hour = parseInt(timeByUnit[0]);
	let minute = parseInt(timeByUnit[1]);

	result.value = minute;	// remove leading '0'

	if (hour > 0) {
		if (hour >= 2) {
			result.value = 'dans plus de 2 heures';
		}
		else {
			result.value = hour + ' heure ' + result.value + ' minutes';
		}
		result.timeUnit = TimeUnit.HOUR;
	}
	else if (minute <= 0) {
		result.value = parseInt(timeByUnit[2]);
		result.timeUnit = TimeUnit.SECOND;
	}
	else {
		result.timeUnit = TimeUnit.MINUTE;
	}

	// Convert '1' number into 'une' in order to have the proper prononciation ('une seconde/minute/heure' and not 'un seconde')
	if (result.value == 1) {
		result.value = 'une';
	}

	return result;
}

/**
 * Convert two waiting times into human listenable waiting times
 * Below are some examples of conversions:
 * 	{"00:00:45", "00:15:00"} => "45 secondes puis dans 15 minutes"
 * 	{"00:10:00", "00:15:00"} => "10 puis dans 15 minutes"
 * 	{"00:01:00"} => "1 minute"
 *
 * @param {Object} waitingTimes :  Array of 1 or 2 time strings under "hh:mm:ss" format
 * @return {String} Human listenable waiting times
 */
function waitingTimeToString(waitingTimes) {
	let strWaitingTimes;

	let strWaitingTime0 = timeToShortTime(waitingTimes[0]);
	strWaitingTimes = strWaitingTime0.value;

	if (waitingTimes.length > 1) {
		// there is two next passages in the array
		let strWaitingTime1 = timeToShortTime(waitingTimes[1]);

		if (strWaitingTime0.timeUnit != strWaitingTime1.timeUnit) {
			// the two next passages have different time units, so time unit is told each time
			strWaitingTimes += strWaitingTime0.timeUnit + ' ';
			if(strWaitingTime0.value > 1) strWaitingTimes += 's';
		}

		strWaitingTimes += ' puis dans ' + strWaitingTime1.value + ' ' + strWaitingTime1.timeUnit;
		if(strWaitingTime1.value > 1) strWaitingTimes += 's';
	}
	else {
		// there is only one next passage
		strWaitingTimes += strWaitingTime0.timeUnit;
		if(strWaitingTime0.value > 1) strWaitingTimes += 's';
	}

	return strWaitingTimes;
}