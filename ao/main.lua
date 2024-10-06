local json = require("json")

-- Initialize state
State = State or {}
State.encryptedUploadConfig = State.encryptedUploadConfig or ""
State.encryptedRenameTracker = State.encryptedRenameTracker or ""

-- Handler for updating the encrypted upload config
Handlers.add(
    "UpdateEncryptedUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "UpdateEncryptedUploadConfig"),
    function(msg)
        local encryptedData = msg.Data
        if encryptedData and encryptedData ~= "" then
            State.encryptedUploadConfig = encryptedData
            print("Updated encrypted upload config")
            ao.send({
                Target = msg.From,
                Action = "UpdateEncryptedUploadConfigResponse",
                Data = json.encode({ success = true, message = "Encrypted upload config updated" })
            })
        else
            print("Error: Invalid encrypted data")
            ao.send({
                Target = msg.From,
                Action = "UpdateEncryptedUploadConfigResponse",
                Data = json.encode({ success = false, message = "Error: Invalid encrypted data" })
            })
        end
    end
)

-- Handler for updating the encrypted rename tracker
Handlers.add(
    "UpdateEncryptedRenameTracker",
    Handlers.utils.hasMatchingTag("Action", "UpdateEncryptedRenameTracker"),
    function(msg)
        local encryptedData = msg.Data
        if encryptedData and encryptedData ~= "" then
            State.encryptedRenameTracker = encryptedData
            print("Updated encrypted rename tracker")
            ao.send({
                Target = msg.From,
                Action = "UpdateEncryptedRenameTrackerResponse",
                Data = json.encode({ success = true, message = "Encrypted rename tracker updated" })
            })
        else
            print("Error: Invalid encrypted rename tracker data")
            ao.send({
                Target = msg.From,
                Action = "UpdateEncryptedRenameTrackerResponse",
                Data = json.encode({ success = false, message = "Error: Invalid encrypted data" })
            })
        end
    end
)

-- Handler for retrieving the encrypted upload config
Handlers.add(
    "GetEncryptedUploadConfig",
    Handlers.utils.hasMatchingTag("Action", "GetEncryptedUploadConfig"),
    function(msg)
        print("Sending encrypted upload config")
        ao.send({
            Target = msg.From,
            Action = "GetEncryptedUploadConfigResponse",
            Data = State.encryptedUploadConfig
        })
    end
)

-- Handler for retrieving the encrypted rename tracker
Handlers.add(
    "GetEncryptedRenameTracker",
    Handlers.utils.hasMatchingTag("Action", "GetEncryptedRenameTracker"),
    function(msg)
        print("Sending encrypted rename tracker")
        ao.send({
            Target = msg.From,
            Action = "GetEncryptedRenameTrackerResponse",
            Data = State.encryptedRenameTracker
        })
    end
)

-- Handler for getting the full state (for debugging purposes)
Handlers.add(
    "GetState",
    Handlers.utils.hasMatchingTag("Action", "GetState"),
    function(msg)
        print("Sending full state")
        ao.send({
            Target = msg.From,
            Action = "GetStateResponse",
            Data = json.encode(State)
        })
    end
)
