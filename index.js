const api_url = "https://api.deezer.com"
const auth_url = "https://connect.deezer.com/oauth/access_token.php"

const apiRequest = (method, url, auth, params, callback) => {

	params.output = 'json'

	if (auth) params.access_token = settings.deezer.access_token
	
	if (!url.includes('https://')) url = api_url+url

	let requestOptions = { url: url, method: method, json: true}
	
	let urlParameters = Object.keys(params).map((i) => typeof params[i] !== 'object' && !getParameterByName(i, requestOptions.url) ? i+'='+params[i]+'&' : '' ).join('') // transforms to url format everything except objects
	requestOptions.url += (requestOptions.url.includes('?') ? '&' : '?') + urlParameters
	
	if (method !== 'GET') {
		requestOptions.json = params
	}

	request(requestOptions, (err, result, body) => {
		if (body && body.error) callback(body.error, body)
		else callback(err, body)
	})
	
}

const auth = (code, callback) => {

	request.post({
		url: auth_url+'?output=json', 
		json: true, 
		form: {
			client_id: settings.clientIds.deezer.client_id,
			client_secret: settings.clientIds.deezer.client_secret,
			grant_type: 'authorization_code',
			redirect_uri: 'http://localhost',
			code: code
		} 
	}, (err, res, body) => {
		callback(err, body)
	})

}

const convertTrack = (rawTrack) => {

	return {
		'service': 'deezer',
		'title': rawTrack.title,
		'share_url': rawTrack.link,
		'album': {
			'name': rawTrack.album.title,
			'id': rawTrack.album.id
		},
		'artist': {
			'name': rawTrack.artist.name,
			'id': rawTrack.artist.id
		},
		'id': rawTrack.id,
		'duration': rawTrack.duration * 1000,
		'artwork': rawTrack.album.cover_small
	}

}


/**
 * Deezer API Abstraction
 */
class Deezer {

	 /**
	 * Fetch data
	 *
	 * @returns {Promise}
	 */
	static fetchData (callback) {
		
		if (!settings.deezer.access_token) {
			settings.deezer.error = true
			return callback([null, true])
		}

		apiRequest('GET', '/user/me/flow', true, {}, (err, result) => {

			if (err) return callback([err])

			let tempTracks = []

			for (let i of result.data) 
				tempTracks.push(convertTrack(i))

			Data.addPlaylist({
				service: 'deezer',
				title: 'Flow', 
				artwork: '', 
				icon: 'user', 
				id: 'flow', 
				tracks: tempTracks
			})

			apiRequest('GET', '/user/me/playlists', true, {limit: 100}, (err, result) => {

				if (err) return callback([err])

				let currentPl = 0
				let toGet = result.data.length

				for (let i of result.data) {
					!function outer(i) {

						apiRequest('GET', i.tracklist.split('.com')[1], true, {}, (err, result) => {

							if (err) return callback(err)

							let tempTracks = []

							function moreTracks(url) {

								apiRequest('GET', url.split('.com')[1], true, {}, (err, result) => {

									if (err) return callback(err)

									for (let t of result.data)
										tempTracks.push(convertTrack(t))

									if (result.next) moreTracks(result.next)
									else over()

								})
							}

							if (result) {
								for (let t of result.data)
									tempTracks.push(convertTrack(t))

								if (result.next) moreTracks(result.next)
								else over()
							}

							function over() {
								if (i.title.trim() == "Loved tracks")
									Data.addPlaylist({
										service: 'deezer',
										title: "Loved tracks",
										id: 'favs',
										icon: 'heart',
										author: {
											name: i.creator.name,
											id: i.creator.id
										},
										artwork: i.picture_medium,
										tracks: tempTracks
									})
								else
									Data.addPlaylist({
										service: 'deezer',
										title: i.title,
										id: i.id,
										editable: (i.creator.id === settings.deezer.userId ? true : false),
										icon: null,
										author: {
											name: i.creator.name,
											id: i.creator.id
										},
										canBeDeleted: true,
										artwork: i.picture_medium,
										tracks: tempTracks
									})

								currentPl += 1

								if (currentPl == toGet) callback()
							}

						})
					}(i)
				}
				
			})
			
		})
	}

	/**
	* Called when user wants to activate the service²
	*
	* @param callback {Function} Callback function
	*/

	static login (callback) {

		const oauthUrl = `https://connect.deezer.com/oauth/auth.php?app_id=${settings.clientIds.deezer.client_id}&redirect_uri=http://localhost&response_type=code&perms=manage_library,offline_access,listening_history,delete_library`
		oauthLogin(oauthUrl, (code) => {
			
			if (!code) return callback('stopped')

			auth(code, (err, data) => {

				if (err) return callback(err)

				// Parsing access token from received data
				settings.deezer.access_token = data.access_token

				apiRequest('GET', '/user/me', true, {}, (err, result) => {
					if (err) return callback(err)

					settings.deezer.userId = result.id
					callback()
				})

			})

		})
	}

	/**
	* Create a Playlist
	*
	* @param name {String} The name of the playlist to be created
	*/
	static createPlaylist (name, callback) {

		apiRequest('POST', '/user/me/playlists', true, {title: name}, (err, playlist) => {

			if (err) return callback(err)

			callback(null, {
				service: 'deezer',
				editable: true,
				canBeDeleted: true,
				title: name,
				id: playlist.id,
				tracks: []
			})

		})

	}

	/**
	* Delete a Playlist (unfollowing it is Spotify's way)
	*
	* @param playlist {Object} The object of the playlist to be deleted
	*/
	static deletePlaylist (playlist, callback) {

		// Different endpoint if we own the playlist or just want to unfollow it
		let path = ((playlist.author.id === settings.deezer.userId.toString()) ? `/playlist/${playlist.id}` : `/user/me/playlists` )
		
		apiRequest('DELETE', path, true, {playlist_id: playlist.id}, (err, result) => {
			callback(err)
			console.log(err, result)
		})

	}


	/**
	* Add tracks to a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static addToPlaylist (tracks, playlistId, callback) {
		let ids = ""

		for (let track of tracks)
			ids += track.id+','

		apiRequest('POST', `/playlist/${playlistId}/tracks`, true, {songs: ids}, (err, result) => {
			callback(err)
		})
	}



	/**
	* Remove tracks from a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static removeFromPlaylist (tracks, playlistId, callback) {
		let ids = ""

		for (let track of tracks)
			ids += track.id+','

		apiRequest('DELETE', `/playlist/${playlistId}/tracks`, true, {songs: ids}, (err, result) => {
			callback(err)
		})
	}


	/**
	 * Like a song
	 *
	 * @param track {Object} The track object
	 */
	static like (track, callback) {
		apiRequest('POST', `/user/me/tracks`, true, {track_id: track.id}, (err, result) => {
			callback(err)
		})
	}

	/**
	 * Unlike a track
	 *
	 * @param track {Object} The track object
	 */
	static unlike (track, callback) {
		apiRequest('DELETE', `/user/me/tracks`, true, {track_id: track.id}, (err, result) => {
			callback(err)
		})
	}
	

	/**
	 * View an artist
	 *
	 * @param track {Object} The track object
	 */
	static viewArtist (tracks) {
		let track = tracks[0]

		specialView('deezer', 'loading', 'artist', track.artist.name)

		apiRequest('GET', `/artist/${track.artist.id}/top`, false, {}, (err, result) => {
			if (err) return console.error(err)

			let temp = []

			for (let tr of result.data)
				temp.push(convertTrack(tr))

			specialView('deezer', temp, 'artist', track.artist.name, result.data[0].contributors[0].picture)
		})
	}

	/**
	 * View an album
	 *
	 * @param track {Object} The track object
	 */
	static viewAlbum (tracks) {
		let track = tracks[0]

		specialView('deezer', 'loading', 'album', track.album.name)

		apiRequest('GET', `/album/${track.album.id}`, false, {}, (err, result) => {
			if (err) return console.error(err)

			let temp = []

			for (let tr of result.tracks.data){
				tr.album = { title: track.album.name, id: track.album.id }
				temp.push(convertTrack(tr))
			}

			specialView('deezer', temp, 'album', track.album.name, result.cover_medium)
		})
	}


	/**
	* Search
	* @param query {String}: the query of the search
	* @param callback
	*/
	static searchTracks (query, callback) {

		apiRequest('GET', `/search`, false, {q: encodeURI(query)}, (err, result) => {

			if (err) return console.error(err)
			let tracks = []

			for (let tr of result.data)
				if (tr) tracks.push(convertTrack(tr))

			callback(tracks, query)

		})
	}

	/*
	* Returns the settings items of this plugin
	*
	*/
	static settingsItems () {
		return [
			{
				type: 'activate',
				id: 'active'
			}
		]
	}

	/*
	* Returns the context menu items of this plugin
	*
	* @param tracks {Array of Objects} The selected tracks object
	*/
	static contextmenuItems (tracks) {
		return [
			{ 
				label: 'View artist', 
				click: () => deezer.viewArtist(tracks)
			}, 
			{ 
				label: 'View album', 
				click: () => deezer.viewAlbum(tracks)
			}
		]
	}

}

/** Static Properties **/
Deezer.favsPlaylistId = "favs"
Deezer.scrobbling = true
Deezer.settings = {
	active: false
}

module.exports = Deezer